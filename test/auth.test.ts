import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomer, setup } from './helpers.ts';

test('health check is public', async () => {
  const { app } = await setup();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
});

test('rejects requests without an API key', async () => {
  const { app } = await setup();
  const res = await app.inject({ method: 'GET', url: '/customers' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().message, 'missing API key');
});

test('rejects an unknown API key', async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: 'GET',
    url: '/customers',
    headers: { authorization: 'Bearer ll_live_not-a-real-key' },
  });
  assert.equal(res.statusCode, 401);
});

test('tenants cannot see each other’s data', async () => {
  const { acme, newTenant } = await setup();
  const globex = newTenant('Globex');
  const customer = await createCustomer(acme);

  assert.equal((await globex.request({ method: 'GET', url: `/customers/${customer.id}` })).status, 404);
  assert.deepEqual((await globex.request({ method: 'GET', url: '/customers' })).body.items, []);
});
