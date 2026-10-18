import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { createTenant } from '../src/tenants.ts';

async function setupAdmin() {
  const db = openDb(':memory:');
  const app = buildApp({ db, adminToken: 'adm_test_token' });
  await app.ready();
  const tenant = createTenant(db, 'Acme Studio');
  return { app, tenant };
}

test('rotating revokes the old key and returns a working new one', async () => {
  const { app, tenant } = await setupAdmin();
  const res = await app.inject({
    method: 'POST',
    url: `/admin/tenants/${tenant.tenantId}/api-keys/rotate`,
    headers: { authorization: 'Bearer adm_test_token' },
  });
  assert.equal(res.statusCode, 201);
  const { api_key } = res.json();

  const old = await app.inject({ method: 'GET', url: '/customers', headers: { authorization: `Bearer ${tenant.apiKey}` } });
  assert.equal(old.statusCode, 401);
  const fresh = await app.inject({ method: 'GET', url: '/customers', headers: { authorization: `Bearer ${api_key}` } });
  assert.equal(fresh.statusCode, 200);
});

test('requires the admin token', async () => {
  const { app, tenant } = await setupAdmin();
  const res = await app.inject({
    method: 'POST',
    url: `/admin/tenants/${tenant.tenantId}/api-keys/rotate`,
    headers: { authorization: `Bearer ${tenant.apiKey}` },
  });
  assert.equal(res.statusCode, 401);
});

test('admin routes do not exist without ADMIN_TOKEN', async () => {
  const db = openDb(':memory:');
  const app = buildApp({ db });
  const res = await app.inject({ method: 'POST', url: '/admin/tenants/ten_x/api-keys/rotate' });
  assert.equal(res.statusCode, 401);
});
