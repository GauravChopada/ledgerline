import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type TestClient, createCustomer, createOpenInvoice, setup } from './helpers.ts';

async function paidByCard(t: TestClient, totalCents: number) {
  const invoice = await createOpenInvoice(t, (await createCustomer(t)).id, totalCents);
  const payment = await t.request({
    method: 'POST',
    url: `/invoices/${invoice.id}/payments`,
    payload: { amount_cents: totalCents, method: 'card', source: 'tok_visa' },
  });
  return { invoice, payment: payment.body };
}

test('a partial refund reopens a paid invoice and refunds the card', async () => {
  const { acme, provider } = await setup();
  const { invoice, payment } = await paidByCard(acme, 120_00);

  const res = await acme.request({
    method: 'POST',
    url: `/payments/${payment.id}/refunds`,
    payload: { amount: 25.5, reason: 'Unused hours' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.amount_cents, 25_50);
  assert.deepEqual(provider.refunds, [{ chargeId: payment.provider_charge_id, amountCents: 25_50 }]);

  const after = await acme.request({ method: 'GET', url: `/invoices/${invoice.id}` });
  assert.equal(after.body.status, 'open');
  assert.equal(after.body.amount_paid_cents, 94_50);
});

test('cannot refund more than was paid', async () => {
  const { acme } = await setup();
  const { payment } = await paidByCard(acme, 50_00);

  const first = await acme.request({ method: 'POST', url: `/payments/${payment.id}/refunds`, payload: { amount: 40 } });
  assert.equal(first.status, 201);
  const second = await acme.request({ method: 'POST', url: `/payments/${payment.id}/refunds`, payload: { amount: 20 } });
  assert.equal(second.status, 422);
  assert.equal(second.body.error, 'invalid_refund_amount');
});

test('refunding a cash payment does not call the gateway', async () => {
  const { acme, provider } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 30_00);
  const payment = await acme.request({
    method: 'POST',
    url: `/invoices/${invoice.id}/payments`,
    payload: { amount_cents: 30_00, method: 'cash' },
  });

  const res = await acme.request({ method: 'POST', url: `/payments/${payment.body.id}/refunds`, payload: { amount: 30 } });
  assert.equal(res.status, 201);
  assert.equal(provider.refunds.length, 0);
});

test('a gateway failure leaves the ledger untouched', async () => {
  const { acme, provider } = await setup();
  const { invoice, payment } = await paidByCard(acme, 80_00);
  provider.refund = async () => {
    throw new Error('gateway timeout');
  };

  const res = await acme.request({ method: 'POST', url: `/payments/${payment.id}/refunds`, payload: { amount: 80 } });
  assert.equal(res.status, 500);

  const after = await acme.request({ method: 'GET', url: `/invoices/${invoice.id}` });
  assert.equal(after.body.status, 'paid');
  assert.equal(after.body.amount_paid_cents, 80_00);
});

test('unknown payment', async () => {
  const { acme } = await setup();
  const res = await acme.request({ method: 'POST', url: '/payments/pay_missing/refunds', payload: { amount: 1 } });
  assert.equal(res.status, 404);
});

test('cannot refund another tenant’s payment', async () => {
  const { acme, newTenant, provider } = await setup();
  const globex = newTenant('Globex');
  const { payment } = await paidByCard(acme, 60_00);
  const res = await globex.request({ method: 'POST', url: `/payments/${payment.id}/refunds`, payload: { amount: 60 } });
  assert.equal(res.status, 404);
  assert.equal(provider.refunds.length, 0);
});
