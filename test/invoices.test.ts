import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomer, setup } from './helpers.ts';

test('creates a draft invoice and totals its lines', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme);
  const res = await acme.request({
    method: 'POST',
    url: '/invoices',
    payload: {
      customer_id: customer.id,
      currency: 'EUR',
      lines: [
        { description: 'Discovery workshop', quantity: 2, unit_amount_cents: 450_00 },
        { description: 'Hosting', quantity: 3, unit_amount_cents: 19_99 },
      ],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'draft');
  assert.equal(res.body.number, 'INV-0001');
  assert.equal(res.body.total_cents, 959_97);
  assert.deepEqual(res.body.lines.map((l: { position: number }) => l.position), [0, 1]);
});

test('numbers invoices sequentially per tenant', async () => {
  const { acme, newTenant } = await setup();
  const globex = newTenant('Globex');
  const lines = [{ description: 'Retainer', quantity: 1, unit_amount_cents: 1000_00 }];

  for (const [tenant, expected] of [[acme, ['INV-0001', 'INV-0002']], [globex, ['INV-0001']]] as const) {
    const customer = await createCustomer(tenant);
    for (const number of expected) {
      const res = await tenant.request({ method: 'POST', url: '/invoices', payload: { customer_id: customer.id, currency: 'USD', lines } });
      assert.equal(res.body.number, number);
    }
  }
});

test('refuses to invoice another tenant’s customer', async () => {
  const { acme, newTenant } = await setup();
  const globex = newTenant('Globex');
  const customer = await createCustomer(acme);
  const res = await globex.request({
    method: 'POST',
    url: '/invoices',
    payload: { customer_id: customer.id, currency: 'USD', lines: [{ description: 'x', quantity: 1, unit_amount_cents: 100 }] },
  });
  assert.equal(res.status, 404);
});

test('validates invoice input', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme);
  const res = await acme.request({
    method: 'POST',
    url: '/invoices',
    payload: { customer_id: customer.id, currency: 'usd', lines: [{ description: 'x', quantity: 1, unit_amount_cents: 12.5 }] },
  });
  assert.equal(res.status, 400);
});

test('finalizes and voids invoices with state checks', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme);
  const created = await acme.request({
    method: 'POST',
    url: '/invoices',
    payload: { customer_id: customer.id, currency: 'USD', lines: [{ description: 'Audit', quantity: 1, unit_amount_cents: 800_00 }] },
  });
  const id = created.body.id;

  const finalized = await acme.request({ method: 'POST', url: `/invoices/${id}/finalize` });
  assert.equal(finalized.body.status, 'open');
  assert.ok(finalized.body.issued_at);

  assert.equal((await acme.request({ method: 'POST', url: `/invoices/${id}/finalize` })).status, 409);

  const voided = await acme.request({ method: 'POST', url: `/invoices/${id}/void` });
  assert.equal(voided.body.status, 'void');
});

test('will not finalize a zero-total invoice', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme);
  const created = await acme.request({
    method: 'POST',
    url: '/invoices',
    payload: { customer_id: customer.id, currency: 'USD', lines: [{ description: 'Freebie', quantity: 1, unit_amount_cents: 0 }] },
  });
  const res = await acme.request({ method: 'POST', url: `/invoices/${created.body.id}/finalize` });
  assert.equal(res.status, 422);
});

test('filters invoices by status', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme);
  const lines = [{ description: 'Sprint', quantity: 1, unit_amount_cents: 100_00 }];
  const draft = await acme.request({ method: 'POST', url: '/invoices', payload: { customer_id: customer.id, currency: 'USD', lines } });
  const open = await acme.request({ method: 'POST', url: '/invoices', payload: { customer_id: customer.id, currency: 'USD', lines } });
  await acme.request({ method: 'POST', url: `/invoices/${open.body.id}/finalize` });

  const drafts = await acme.request({ method: 'GET', url: '/invoices?status=draft' });
  assert.deepEqual(drafts.body.items.map((i: { id: string }) => i.id), [draft.body.id]);

  const everything = await acme.request({ method: 'GET', url: '/invoices' });
  assert.equal(everything.body.items.length, 2);
});
