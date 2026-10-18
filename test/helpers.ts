import type { FastifyInstance, InjectOptions } from 'fastify';
import { after } from 'node:test';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { createTenant } from '../src/tenants.ts';

export type TestClient = {
  app: FastifyInstance;
  apiKey: string;
  request: (opts: InjectOptions) => Promise<{ status: number; body: any }>;
};

/**
 * Fresh in-memory database with one tenant. The clock starts at 2026-03-01T10:00:00Z and moves
 * forward one second every time the app reads it, so every row gets a distinct timestamp.
 */
export async function setup(start = '2026-03-01T10:00:00.000Z') {
  const db = openDb(':memory:');
  let clock = new Date(start).getTime();
  const now = () => new Date((clock += 1000));
  const app = buildApp({ db, now });
  await app.ready();
  after(() => app.close());

  const client = (apiKey: string): TestClient => ({
    app,
    apiKey,
    request: async (opts) => {
      const res = await app.inject({
        ...opts,
        headers: { authorization: `Bearer ${apiKey}`, ...opts.headers },
      });
      return { status: res.statusCode, body: res.body ? res.json() : undefined };
    },
  });

  const acme = client(createTenant(db, 'Acme Studio').apiKey);
  return {
    db,
    app,
    acme,
    newTenant: (name: string) => client(createTenant(db, name).apiKey),
    setClock: (iso: string) => {
      clock = new Date(iso).getTime() - 1000;
    },
  };
}

let customerSeq = 0;

export async function createCustomer(t: TestClient, name = 'Ada Lovelace', email = `ada.${++customerSeq}@example.com`) {
  const res = await t.request({ method: 'POST', url: '/customers', payload: { name, email } });
  if (res.status !== 201) throw new Error(`createCustomer failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createOpenInvoice(t: TestClient, customerId: string, totalCents = 150_00, currency = 'USD') {
  const created = await t.request({
    method: 'POST',
    url: '/invoices',
    payload: {
      customer_id: customerId,
      currency,
      lines: [{ description: 'Design sprint', quantity: 1, unit_amount_cents: totalCents }],
    },
  });
  if (created.status !== 201) throw new Error(`createInvoice failed: ${JSON.stringify(created.body)}`);
  const finalized = await t.request({ method: 'POST', url: `/invoices/${created.body.id}/finalize` });
  return finalized.body;
}
