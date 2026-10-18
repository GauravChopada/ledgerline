// Private proofs for PR 3 seeds. Each test PASSES when the bug is present.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../ledgerline/src/app.ts';
import { openDb } from '../ledgerline/src/db.ts';
import { createTenant } from '../ledgerline/src/tenants.ts';
import { createCustomer, createOpenInvoice, setup } from '../ledgerline/test/helpers.ts';

test('S3.1 rows sharing created_at with the page boundary are skipped', async () => {
  const db = openDb(':memory:');
  const frozen = new Date('2026-03-01T10:00:00.000Z');
  const app = buildApp({ db, now: () => frozen }); // e.g. a bulk import: same millisecond
  const { apiKey } = createTenant(db, 'Bulk');
  const headers = { authorization: `Bearer ${apiKey}` };
  for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/customers', headers, payload: { name: `C${i}`, email: `c${i}@example.com` } });
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const res = (await app.inject({ method: 'GET', url: `/customers?limit=2${cursor ? `&cursor=${cursor}` : ''}`, headers })).json();
    seen.push(...res.items.map((c: { id: string }) => c.id));
    cursor = res.next_cursor;
  } while (cursor);
  assert.equal(seen.length, 2, `only ${seen.length} of 5 customers reachable through pagination`);
});

test('S3.2 voided invoices vanish from the customer statement view (and from GET /invoices)', async () => {
  const { acme } = await setup();
  const ada = await createCustomer(acme);
  const inv = await createOpenInvoice(acme, ada.id);
  await acme.request({ method: 'POST', url: `/invoices/${inv.id}/void` });
  const statement = await acme.request({ method: 'GET', url: `/customers/${ada.id}/invoices` });
  assert.deepEqual(statement.body.items, []);
  const all = await acme.request({ method: 'GET', url: '/invoices' });
  assert.deepEqual(all.body.items, []);
});

test('S3.3 a malformed cursor returns 200 with an empty page instead of 400', async () => {
  const { acme } = await setup();
  await createCustomer(acme);
  const res = await acme.request({ method: 'GET', url: '/invoices?cursor=%%%not-base64' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
});
