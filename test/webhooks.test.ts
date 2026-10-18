import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { createTenant } from '../src/tenants.ts';
import { sign } from '../src/webhooks/signature.ts';

const SECRET = 'whsec_test_secret';

async function setupWithWebhooks(webhookSecret: string | null = SECRET) {
  const db = openDb(':memory:');
  const app = buildApp({ db, webhookSecret: webhookSecret ?? undefined });
  await app.ready();
  const { tenantId, apiKey } = createTenant(db, 'Acme Studio');
  const auth = { authorization: `Bearer ${apiKey}` };

  const customer = (await app.inject({ method: 'POST', url: '/customers', headers: auth, payload: { name: 'Ada', email: 'ada@example.com' } })).json();
  const draft = (
    await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth,
      payload: { customer_id: customer.id, currency: 'USD', lines: [{ description: 'Build', quantity: 1, unit_amount_cents: 400_00 }] },
    })
  ).json();
  await app.inject({ method: 'POST', url: `/invoices/${draft.id}/finalize`, headers: auth });

  const invoice = async () => (await app.inject({ method: 'GET', url: `/invoices/${draft.id}`, headers: auth })).json();
  const deliver = (event: object, signature?: string) => {
    const body = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    return app.inject({
      method: 'POST',
      url: '/webhooks/provider',
      headers: {
        'content-type': 'application/json',
        'provider-signature': signature ?? `t=${timestamp},v1=${sign(body, SECRET, timestamp)}`,
      },
      payload: body,
    });
  };
  const chargeSucceeded = (id: string, amount = 400_00) => ({
    id,
    type: 'charge.succeeded',
    data: { charge_id: `ch_${id}`, amount_cents: amount, currency: 'USD', metadata: { tenant_id: tenantId, invoice_id: draft.id } },
  });

  return { app, deliver, chargeSucceeded, invoice };
}

test('a signed charge.succeeded event records the payment', async () => {
  const { deliver, chargeSucceeded, invoice } = await setupWithWebhooks();
  const res = await deliver(chargeSucceeded('evt_1'));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, 'payment_recorded');
  assert.equal((await invoice()).status, 'paid');
});

test('rejects a bad signature', async () => {
  const { deliver, chargeSucceeded, invoice } = await setupWithWebhooks();
  const res = await deliver(chargeSucceeded('evt_1'), `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'invalid_signature');
  assert.equal((await invoice()).status, 'open');
});

test('rejects a missing signature header', async () => {
  const { app } = await setupWithWebhooks();
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/provider',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ id: 'evt_x', type: 'charge.succeeded', data: {} }),
  });
  assert.equal(res.statusCode, 400);
});

test('accepts any of several v1 signatures during secret rotation', async () => {
  const { deliver, chargeSucceeded } = await setupWithWebhooks();
  const event = chargeSucceeded('evt_rot');
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const res = await deliver(event, `t=${t},v1=${sign(body, 'old_secret', t)},v1=${sign(body, SECRET, t)}`);
  assert.equal(res.statusCode, 200);
});

test('a redelivered event is applied once', async () => {
  const { deliver, chargeSucceeded, invoice } = await setupWithWebhooks();
  await deliver(chargeSucceeded('evt_1', 100_00));
  const again = await deliver(chargeSucceeded('evt_1', 100_00));
  assert.equal(again.json().outcome, 'duplicate');
  assert.equal((await invoice()).amount_paid_cents, 100_00);
});

test('ignores events it cannot apply', async () => {
  const { deliver, chargeSucceeded } = await setupWithWebhooks();
  const wrongCurrency = chargeSucceeded('evt_eur');
  wrongCurrency.data.currency = 'EUR';
  assert.equal((await deliver(wrongCurrency)).json().outcome, 'ignored');
  assert.equal((await deliver({ id: 'evt_other', type: 'customer.updated', data: {} })).json().outcome, 'ignored');
});

test('local development accepts unsigned events when no secret is configured', async () => {
  const { app, chargeSucceeded, invoice } = await setupWithWebhooks(null);
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/provider',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(chargeSucceeded('evt_dev')),
  });
  assert.equal(res.statusCode, 200);
  assert.equal((await invoice()).status, 'paid');
});
