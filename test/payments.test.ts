import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomer, createOpenInvoice, setup } from './helpers.ts';

test('partial then full payment marks the invoice paid', async () => {
  const { acme } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 300_00);

  const first = await acme.request({
    method: 'POST',
    url: `/invoices/${invoice.id}/payments`,
    payload: { amount_cents: 100_00, method: 'bank_transfer' },
  });
  assert.equal(first.status, 201);
  assert.equal((await acme.request({ method: 'GET', url: `/invoices/${invoice.id}` })).body.status, 'open');

  await acme.request({ method: 'POST', url: `/invoices/${invoice.id}/payments`, payload: { amount_cents: 200_00, method: 'card', source: 'tok_visa' } });
  const after = await acme.request({ method: 'GET', url: `/invoices/${invoice.id}` });
  assert.equal(after.body.status, 'paid');
  assert.equal(after.body.amount_paid_cents, 300_00);
});

test('rejects overpayment', async () => {
  const { acme } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 50_00);
  const res = await acme.request({
    method: 'POST',
    url: `/invoices/${invoice.id}/payments`,
    payload: { amount_cents: 50_01, method: 'cash' },
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'overpayment');
});

test('only open invoices accept payments', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme);
  const draft = await acme.request({
    method: 'POST',
    url: '/invoices',
    payload: { customer_id: customer.id, currency: 'USD', lines: [{ description: 'x', quantity: 1, unit_amount_cents: 100 }] },
  });
  const res = await acme.request({
    method: 'POST',
    url: `/invoices/${draft.body.id}/payments`,
    payload: { amount_cents: 100, method: 'cash' },
  });
  assert.equal(res.status, 409);
});

test('cannot pay another tenant’s invoice', async () => {
  const { acme, newTenant } = await setup();
  const globex = newTenant('Globex');
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id);
  const res = await globex.request({
    method: 'POST',
    url: `/invoices/${invoice.id}/payments`,
    payload: { amount_cents: 100, method: 'cash' },
  });
  assert.equal(res.status, 404);
});

test('lists payments newest first', async () => {
  const { acme } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 300_00);
  for (const amount of [100_00, 50_00]) {
    await acme.request({ method: 'POST', url: `/invoices/${invoice.id}/payments`, payload: { amount_cents: amount, method: 'cash' } });
  }
  const res = await acme.request({ method: 'GET', url: '/payments' });
  assert.deepEqual(res.body.items.map((p: { amount_cents: number }) => p.amount_cents), [50_00, 100_00]);
});
