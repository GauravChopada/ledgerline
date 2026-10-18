// Private proofs for PR 2 seeds. Each test PASSES when the bug is present.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../ledgerline/src/app.ts';
import { openDb } from '../ledgerline/src/db.ts';
import { createTenant } from '../ledgerline/src/tenants.ts';
import { sign, verifySignature } from '../ledgerline/src/webhooks/signature.ts';

async function victim(webhookSecret?: string) {
  const db = openDb(':memory:');
  const app = buildApp({ db, webhookSecret });
  const { tenantId, apiKey } = createTenant(db, 'Victim');
  const auth = { authorization: `Bearer ${apiKey}` };
  const c = (await app.inject({ method: 'POST', url: '/customers', headers: auth, payload: { name: 'A', email: 'a@example.com' } })).json();
  const inv = (await app.inject({ method: 'POST', url: '/invoices', headers: auth, payload: { customer_id: c.id, currency: 'USD', lines: [{ description: 'x', quantity: 1, unit_amount_cents: 999_00 }] } })).json();
  await app.inject({ method: 'POST', url: `/invoices/${inv.id}/finalize`, headers: auth });
  const forged = { id: 'evt_forged', type: 'charge.succeeded', data: { charge_id: 'ch_fake', amount_cents: 999_00, currency: 'USD', metadata: { tenant_id: tenantId, invoice_id: inv.id } } };
  const status = async () => (await app.inject({ method: 'GET', url: `/invoices/${inv.id}`, headers: auth })).json().status;
  return { app, forged, status };
}

test('S2.1 signature check uses a non-constant-time string comparison', () => {
  // Static: verifySignature compares hex strings with ===. Proven by inspection; behaviourally it still verifies.
  const body = Buffer.from('{}'); const t = 1;
  assert.equal(verifySignature(body, `t=${t},v1=${sign(body, 's', t)}`, 's'), true);
});

test('S2.2 a captured event replays forever: a 2-year-old timestamp still verifies', () => {
  const body = Buffer.from('{"id":"evt_old"}');
  const twoYearsAgo = Math.floor(Date.now() / 1000) - 2 * 365 * 24 * 3600;
  assert.equal(verifySignature(body, `t=${twoYearsAgo},v1=${sign(body, 'whsec', twoYearsAgo)}`, 'whsec'), true);
});

test('S2.3 with PROVIDER_WEBHOOK_SECRET unset (fail-open), an unsigned forged event marks an invoice paid', async () => {
  const { app, forged, status } = await victim(undefined);
  const res = await app.inject({ method: 'POST', url: '/webhooks/provider', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(forged) });
  assert.equal(res.statusCode, 200);
  assert.equal(await status(), 'paid');
});
