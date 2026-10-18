import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomer, createOpenInvoice, setup } from './helpers.ts';

test('creates and fetches a customer', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme, 'Grace Hopper', 'grace@example.com');
  assert.match(customer.id, /^cus_/);
  assert.equal(customer.tenant_id, undefined, 'tenant_id is internal');

  const res = await acme.request({ method: 'GET', url: `/customers/${customer.id}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'grace@example.com');
});

test('validates customer input', async () => {
  const { acme } = await setup();
  const res = await acme.request({ method: 'POST', url: '/customers', payload: { name: '', email: 'nope' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
});

test('updates a customer', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme);
  const res = await acme.request({ method: 'PATCH', url: `/customers/${customer.id}`, payload: { name: 'Ada King' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Ada King');
  assert.equal(res.body.email, customer.email);
  assert.notEqual(res.body.updated_at, customer.updated_at);
});

test('paginates customers newest first', async () => {
  const { acme } = await setup();
  for (let i = 1; i <= 5; i++) await createCustomer(acme, `Customer ${i}`, `c${i}@example.com`);

  const first = await acme.request({ method: 'GET', url: '/customers?limit=2' });
  assert.deepEqual(first.body.items.map((c: { name: string }) => c.name), ['Customer 5', 'Customer 4']);
  assert.ok(first.body.next_cursor);

  const second = await acme.request({ method: 'GET', url: `/customers?limit=2&cursor=${first.body.next_cursor}` });
  assert.deepEqual(second.body.items.map((c: { name: string }) => c.name), ['Customer 3', 'Customer 2']);

  const third = await acme.request({ method: 'GET', url: `/customers?limit=2&cursor=${second.body.next_cursor}` });
  assert.deepEqual(third.body.items.map((c: { name: string }) => c.name), ['Customer 1']);
  assert.equal(third.body.next_cursor, null);
});

test('rejects a malformed cursor', async () => {
  const { acme } = await setup();
  const res = await acme.request({ method: 'GET', url: '/customers?cursor=garbage' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_cursor');
});

test('lists a customer’s invoices', async () => {
  const { acme } = await setup();
  const ada = await createCustomer(acme);
  const bob = await createCustomer(acme, 'Bob', 'bob@example.com');
  const invoice = await createOpenInvoice(acme, ada.id);
  await createOpenInvoice(acme, bob.id);

  const res = await acme.request({ method: 'GET', url: `/customers/${ada.id}/invoices` });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i: { id: string }) => i.id), [invoice.id]);
});
