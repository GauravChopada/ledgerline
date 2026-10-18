import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvField, csvRow, formatAmount, plainText } from '../src/csv.ts';
import { createCustomer, createOpenInvoice, setup } from './helpers.ts';

const lines = (body: string) => body.replace(/^﻿/, '').trimEnd().split('\r\n');

test('csv fields are quoted only when needed', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('Smith, Jo'), '"Smith, Jo"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvField('Acme;=1+1'), '"Acme;=1+1"', 'semicolon-separated locales');
  assert.equal(csvField('tab\there'), '"tab\there"');
  assert.equal(csvRow(['a', 'b,c']), 'a,"b,c"\r\n');
});

test('formula-like text is neutralised', () => {
  for (const evil of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) assert.equal(plainText(evil), `'${evil}`);
  assert.equal(plainText('Ada = genius'), 'Ada = genius');
});

test('amounts are formatted exactly from cents', () => {
  assert.equal(formatAmount(0), '0.00');
  assert.equal(formatAmount(5), '0.05');
  assert.equal(formatAmount(1999), '19.99');
  assert.equal(formatAmount(123456), '1234.56');
  assert.equal(formatAmount(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  assert.throws(() => formatAmount(-1), RangeError);
  assert.throws(() => formatAmount(1.5), RangeError);
});

test('exports the tenant’s invoices as CSV', async () => {
  const { acme, newTenant } = await setup();
  const globex = newTenant('Globex');
  const customer = await createCustomer(acme, 'Lovelace, "Ada"', 'ada@example.com');
  const invoice = await createOpenInvoice(acme, customer.id, 1234_56);
  await acme.request({ method: 'POST', url: `/invoices/${invoice.id}/payments`, payload: { amount_cents: 234_56, method: 'cash' } });
  await createOpenInvoice(globex, (await createCustomer(globex)).id);

  const res = await acme.app.inject({ method: 'GET', url: '/invoices/export.csv', headers: { authorization: `Bearer ${acme.apiKey}` } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.match(String(res.headers['content-disposition']), /^attachment; filename="invoices-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.ok(res.body.startsWith('﻿'));
  assert.deepEqual(lines(res.body), [
    'number,status,customer_name,customer_email,currency,total,amount_paid,amount_due,issued_at,due_at',
    `INV-0001,open,"Lovelace, ""Ada""",ada@example.com,USD,1234.56,234.56,1000.00,${invoice.issued_at},`,
  ]);
});

test('customer names cannot inject spreadsheet formulas', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme, '=HYPERLINK("https://evil.example","Click")', 'x@example.com');
  await createOpenInvoice(acme, customer.id);
  const res = await acme.app.inject({ method: 'GET', url: '/invoices/export.csv', headers: { authorization: `Bearer ${acme.apiKey}` } });
  assert.match(lines(res.body)[1] ?? '', /^INV-0001,open,"'=HYPERLINK\(""https:\/\/evil\.example"",""Click""\)",/);
});

test('filters by status and sorts', async () => {
  const { acme } = await setup();
  const customer = await createCustomer(acme);
  await createOpenInvoice(acme, customer.id);
  await createOpenInvoice(acme, customer.id);
  await acme.request({
    method: 'POST',
    url: '/invoices',
    payload: { customer_id: customer.id, currency: 'USD', lines: [{ description: 'Draft', quantity: 1, unit_amount_cents: 100 }] },
  });
  const get = (qs: string) =>
    acme.app.inject({ method: 'GET', url: `/invoices/export.csv?${qs}`, headers: { authorization: `Bearer ${acme.apiKey}` } });

  const open = lines((await get('status=open&order=desc')).body).slice(1).map((l) => l.split(',')[0]);
  assert.deepEqual(open, ['INV-0002', 'INV-0001']);

  const byIssued = lines((await get('sort=issued_at')).body).slice(1).map((l) => l.split(',')[0]);
  assert.deepEqual(byIssued, ['INV-0001', 'INV-0002', 'INV-0003'], 'drafts have no issue date and sort last');

  assert.equal((await get('sort=total_cents')).statusCode, 400);
});

test('the export route does not shadow invoice lookups', async () => {
  const { acme } = await setup();
  const invoice = await createOpenInvoice(acme, (await createCustomer(acme)).id);
  assert.equal((await acme.request({ method: 'GET', url: `/invoices/${invoice.id}` })).status, 200);
});
