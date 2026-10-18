import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomer, createOpenInvoice, setup } from './helpers.ts';

test('sums revenue per month and currency', async () => {
  const { acme, setClock } = await setup('2026-01-10T09:00:00.000Z');
  const customer = await createCustomer(acme);
  const usd = await createOpenInvoice(acme, customer.id, 1000_00, 'USD');
  const eur = await createOpenInvoice(acme, customer.id, 500_00, 'EUR');

  const pay = (invoiceId: string, amount: number) =>
    acme.request({ method: 'POST', url: `/invoices/${invoiceId}/payments`, payload: { amount_cents: amount, method: 'bank_transfer' } });

  setClock('2026-01-15T12:00:00.000Z');
  await pay(usd.id, 200_00);
  await pay(eur.id, 500_00);
  setClock('2026-02-14T12:00:00.000Z');
  await pay(usd.id, 300_00);
  setClock('2027-02-14T12:00:00.000Z');
  await pay(usd.id, 100_00);

  const res = await acme.request({ method: 'GET', url: '/reports/revenue?year=2026' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows, [
    { month: '2026-01', currency: 'USD', total_cents: 200_00 },
    { month: '2026-01', currency: 'EUR', total_cents: 500_00 },
    { month: '2026-02', currency: 'USD', total_cents: 300_00 },
  ]);
});

test('requires a valid year', async () => {
  const { acme } = await setup();
  assert.equal((await acme.request({ method: 'GET', url: '/reports/revenue?year=abc' })).status, 400);
});
