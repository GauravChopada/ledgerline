// Private proofs for PR 4 seeds. Run with TZ=Asia/Kolkata. Each test PASSES when the bug is present.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createCustomer, createOpenInvoice, setup } from '../ledgerline/test/helpers.ts';

test('S4.1 renaming a customer leaves the old name in invoice lists', async () => {
  const { acme } = await setup();
  const c = await createCustomer(acme, 'Old Name', 'old@example.com');
  await createOpenInvoice(acme, c.id);
  await acme.request({ method: 'GET', url: '/invoices' }); // warms the cache
  await acme.request({ method: 'PATCH', url: `/customers/${c.id}`, payload: { name: 'New Name', email: 'new@example.com' } });
  const res = await acme.request({ method: 'GET', url: '/invoices' });
  assert.equal(res.body.items[0].customer.name, 'Old Name');
  assert.equal(res.body.items[0].customer.email, 'old@example.com', 'invoices go out to a stale email address');
});

test('S4.2 the customer cache has no size bound or eviction', () => {
  const src = readFileSync(new URL('../ledgerline/src/customer-cache.ts', import.meta.url), 'utf8');
  assert.match(src, /new Map<string, CustomerSummary>\(\)/);
  assert.doesNotMatch(src, /\.delete\(|\.clear\(|max|ttl|size/i);
});

test('S4.3 month buckets use server-local time: Dec 31 evening UTC lands in January of the same year', async () => {
  assert.equal(process.env.TZ, 'Asia/Kolkata', 'run under a non-UTC TZ');
  const { acme, setClock } = await setup('2026-01-01T00:00:00.000Z');
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 300_00);
  const pay = (iso: string, amount: number) => { setClock(iso); return acme.request({ method: 'POST', url: `/invoices/${invoice.id}/payments`, payload: { amount_cents: amount, method: 'cash' } }); };
  await pay('2026-01-31T20:00:00.000Z', 100_00); // UTC January
  await pay('2026-12-31T20:00:00.000Z', 200_00); // UTC December
  const rows = (await acme.request({ method: 'GET', url: '/reports/revenue?year=2026' })).body.rows;
  const total = (m: string) => rows.find((r: { month: string }) => r.month === m).total_cents;
  assert.equal(total('2026-01'), 200_00, 'December revenue reported as January');
  assert.equal(total('2026-02'), 100_00, 'January revenue reported as February');
  assert.equal(total('2026-12'), 0);
});
