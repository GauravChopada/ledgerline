import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomer, createOpenInvoice, setup } from './helpers.ts';

test('sums revenue per month and currency', async () => {
  const { acme, setClock } = await setup('2026-01-10T09:00:00.000Z');
  const customer = await createCustomer(acme);
  const usd = await createOpenInvoice(acme, customer.id, 1000_00, 'USD');
  const eur = await createOpenInvoice(acme, customer.id, 500_00, 'EUR');

  const pay = (invoiceId: string, amount: number) =>
    acme.request({ method: 'POST', url: `/invoices/${invoiceId}/payments`, payload: { amount_cents: amount, method: 'card' } });

  setClock('2026-01-15T12:00:00.000Z');
  await pay(usd.id, 200_00);
  await pay(eur.id, 500_00);
  setClock('2026-02-14T12:00:00.000Z');
  await pay(usd.id, 300_00);
  setClock('2027-02-14T12:00:00.000Z');
  await pay(usd.id, 100_00);

  const res = await acme.request({ method: 'GET', url: '/reports/revenue?year=2026' });
  assert.equal(res.status, 200);
  const nonZero = res.body.rows.filter((r: { total_cents: number }) => r.total_cents > 0);
  assert.deepEqual(nonZero, [
    { month: '2026-01', currency: 'EUR', total_cents: 500_00 },
    { month: '2026-01', currency: 'USD', total_cents: 200_00 },
    { month: '2026-02', currency: 'USD', total_cents: 300_00 },
  ]);
});

test('reports all twelve months per currency', async () => {
  const { acme, setClock } = await setup('2026-05-01T09:00:00.000Z');
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 100_00);
  setClock('2026-05-20T12:00:00.000Z');
  await acme.request({ method: 'POST', url: `/invoices/${invoice.id}/payments`, payload: { amount_cents: 100_00, method: 'cash' } });

  const res = await acme.request({ method: 'GET', url: '/reports/revenue?year=2026' });
  assert.equal(res.body.rows.length, 12);
  assert.deepEqual(res.body.rows.map((r: { month: string }) => r.month).slice(0, 3), ['2026-01', '2026-02', '2026-03']);
  assert.equal(res.body.rows[4].total_cents, 100_00);
});

test('requires a valid year', async () => {
  const { acme } = await setup();
  assert.equal((await acme.request({ method: 'GET', url: '/reports/revenue?year=abc' })).status, 400);
});
