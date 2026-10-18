// Private proofs for PR 5 seeds. Each test PASSES when the bug is present.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { migrate, openDb, run } from '../ledgerline/src/db.ts';
import { createTenant } from '../ledgerline/src/tenants.ts';
import { setup } from '../ledgerline/test/helpers.ts';

const repo = new URL('../ledgerline/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, repo), 'utf8');

test('S5.1 pull_request_target runs untrusted PR code with a write token and later secret-bearing steps', () => {
  const wf = read('.github/workflows/preview.yml');
  assert.match(wf, /pull_request_target/);
  assert.match(wf, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.ok(wf.indexOf('npm ci') < wf.indexOf('FLY_API_TOKEN'), 'attacker-controlled install/test scripts run first and can poison GITHUB_ENV/GITHUB_PATH for the deploy step');
  assert.match(wf, /pull-requests: write/);
});

test('S5.2a two tenants cannot both have a customer with the same email (409 leaks that the email exists elsewhere)', async () => {
  const { acme, newTenant } = await setup();
  const globex = newTenant('Globex');
  const payload = { name: 'Shared client', email: 'billing@bigclient.com' };
  assert.equal((await acme.request({ method: 'POST', url: '/customers', payload })).status, 201);
  const res = await globex.request({ method: 'POST', url: '/customers', payload });
  assert.equal(res.status, 409);
});

test('S5.2b migration 006 aborts on an existing database where two tenants share a customer email', () => {
  const db = openDb(':memory:');
  db.exec('DROP INDEX customers_email');
  run(db, 'DELETE FROM schema_migrations WHERE version = 6');
  for (const name of ['A', 'B']) {
    const { tenantId } = createTenant(db, name);
    run(db, "INSERT INTO customers (id, tenant_id, name, email, created_at, updated_at) VALUES (?, ?, 'X', 'Shared@Client.com', 't', 't')", `cus_${name}`, tenantId);
  }
  assert.throws(() => migrate(db), /UNIQUE constraint failed/);
});

test('S5.3a container runs as root', () => {
  assert.doesNotMatch(read('Dockerfile'), /^USER /m);
});

test('S5.3b no .dockerignore: COPY . . bakes .env, local *.db and host node_modules into the image', () => {
  assert.match(read('Dockerfile'), /^COPY \. \.$/m);
  assert.equal(existsSync(new URL('.dockerignore', repo)), false);
});
