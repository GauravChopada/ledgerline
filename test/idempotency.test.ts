import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomer, createOpenInvoice, setup } from './helpers.ts';

test('a retried card payment is charged once and replays the first response', async () => {
  const { acme, provider } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 200_00);
  const send = () =>
    acme.request({
      method: 'POST',
      url: `/invoices/${invoice.id}/payments`,
      headers: { 'idempotency-key': 'retry-123' },
      payload: { amount_cents: 200_00, method: 'card', source: 'tok_visa' },
    });

  const first = await send();
  const retry = await send();

  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.body, first.body);
  assert.equal(provider.charges.length, 1);
  assert.equal(first.body.provider_charge_id, 'ch_sandbox_1');
});

test('reusing a key for a different request is rejected', async () => {
  const { acme } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 200_00);
  const pay = (amount: number) =>
    acme.request({
      method: 'POST',
      url: `/invoices/${invoice.id}/payments`,
      headers: { 'idempotency-key': 'k1' },
      payload: { amount_cents: amount, method: 'cash' },
    });

  assert.equal((await pay(50_00)).status, 201);
  const res = await pay(60_00);
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'idempotency_key_reused');
});

test('keys are scoped to a tenant', async () => {
  const { acme, newTenant } = await setup();
  const globex = newTenant('Globex');
  for (const tenant of [acme, globex]) {
    const invoice = await createOpenInvoice(tenant, (await createCustomer(tenant)).id, 10_00);
    const res = await tenant.request({
      method: 'POST',
      url: `/invoices/${invoice.id}/payments`,
      headers: { 'idempotency-key': 'shared-key' },
      payload: { amount_cents: 10_00, method: 'cash' },
    });
    assert.equal(res.status, 201);
  }
});

test('a declined card is not stored, so the client can retry with the same key', async () => {
  const { acme, provider } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id, 10_00);
  const pay = (source: string) =>
    acme.request({
      method: 'POST',
      url: `/invoices/${invoice.id}/payments`,
      headers: { 'idempotency-key': 'card-attempt' },
      payload: { amount_cents: 10_00, method: 'card', source },
    });

  assert.equal((await pay('tok_fail_insufficient_funds')).status, 402);
  assert.equal((await pay('tok_fail_insufficient_funds')).status, 402);
  assert.equal(provider.charges.length, 0);
});

test('card payments require a source', async () => {
  const { acme } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id);
  const res = await acme.request({
    method: 'POST',
    url: `/invoices/${invoice.id}/payments`,
    payload: { amount_cents: 100, method: 'card' },
  });
  assert.equal(res.status, 400);
});
