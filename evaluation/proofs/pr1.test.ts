// Private proofs that each PR 1 seed is a real, reachable defect. Each test PASSES when the bug is present.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomer, createOpenInvoice, setup } from '../ledgerline/test/helpers.ts';

test('S1.1 concurrent retries with one Idempotency-Key charge the card twice', async () => {
  const { acme, provider } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 200_00);
  const send = () => acme.request({
    method: 'POST', url: `/invoices/${invoice.id}/payments`,
    headers: { 'idempotency-key': 'double-click' },
    payload: { amount_cents: 100_00, method: 'card', source: 'tok_visa' },
  });
  const [a, b] = await Promise.all([send(), send()]);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.notEqual(a.body.id, b.body.id, 'two distinct payments recorded');
  assert.equal(provider.charges.length, 2, 'card charged twice');
});

test('S1.2 refund of 19.99 refunds 1998 cents', async () => {
  const { acme } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 50_00);
  const p = await acme.request({ method: 'POST', url: `/invoices/${invoice.id}/payments`, payload: { amount_cents: 50_00, method: 'cash' } });
  const r = await acme.request({ method: 'POST', url: `/payments/${p.body.id}/refunds`, payload: { amount: 19.99 } });
  assert.equal(r.body.amount_cents, 19_98);
});

test('S1.3 another tenant can refund my payment', async () => {
  const { acme, newTenant, provider } = await setup();
  const mallory = newTenant('Mallory');
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 90_00);
  const p = await acme.request({ method: 'POST', url: `/invoices/${invoice.id}/payments`, payload: { amount_cents: 90_00, method: 'card', source: 'tok_visa' } });
  const r = await mallory.request({ method: 'POST', url: `/payments/${p.body.id}/refunds`, payload: { amount: 90 } });
  assert.equal(r.status, 201);
  assert.equal(provider.refunds.length, 1, "victim's card charge refunded by another tenant");
});
