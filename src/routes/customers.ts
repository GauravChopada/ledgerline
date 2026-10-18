import type { FastifyInstance } from 'fastify';
import type { SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { type Db, all, get, run } from '../db.ts';
import { IdParams, notFound, parse } from '../http.ts';
import { newId } from '../ids.ts';
import { PageQuery, decodeCursor, toPage } from '../pagination.ts';
import { listInvoices } from './invoices.ts';

export type Customer = {
  id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
};

const COLUMNS = 'id, name, email, created_at, updated_at';

const CreateCustomer = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
});

const UpdateCustomer = CreateCustomer.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'provide at least one field to update',
});

export function getCustomer(db: Db, tenantId: string, id: string): Customer | undefined {
  return get<Customer>(db, `SELECT ${COLUMNS} FROM customers WHERE id = ? AND tenant_id = ?`, id, tenantId);
}

export function customerRoutes(app: FastifyInstance, { db, now }: Deps): void {
  app.post('/customers', async (req, reply) => {
    const body = parse(CreateCustomer, req.body);
    const timestamp = now().toISOString();
    const id = newId('cus');
    run(
      db,
      'INSERT INTO customers (id, tenant_id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      req.tenantId,
      body.name,
      body.email,
      timestamp,
      timestamp,
    );
    return reply.code(201).send(getCustomer(db, req.tenantId, id));
  });

  app.get('/customers', async (req) => {
    const q = parse(PageQuery, req.query);
    const where = ['tenant_id = ?'];
    const params: SQLInputValue[] = [req.tenantId];
    if (q.cursor) {
      const cursor = decodeCursor(q.cursor);
      where.push('(created_at, id) < (?, ?)');
      params.push(cursor.createdAt, cursor.id);
    }
    const rows = all<Customer>(
      db,
      `SELECT ${COLUMNS} FROM customers WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      ...params,
      q.limit + 1,
    );
    return toPage(rows, q.limit);
  });

  app.get('/customers/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const customer = getCustomer(db, req.tenantId, id);
    if (!customer) throw notFound('customer');
    return customer;
  });

  app.patch('/customers/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateCustomer, req.body);
    const existing = getCustomer(db, req.tenantId, id);
    if (!existing) throw notFound('customer');
    run(
      db,
      'UPDATE customers SET name = ?, email = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
      body.name ?? existing.name,
      body.email ?? existing.email,
      now().toISOString(),
      id,
      req.tenantId,
    );
    return getCustomer(db, req.tenantId, id);
  });

  // Statement view: every invoice the customer has ever been sent, whatever its status.
  app.get('/customers/:id/invoices', async (req) => {
    const { id } = parse(IdParams, req.params);
    if (!getCustomer(db, req.tenantId, id)) throw notFound('customer');
    const q = parse(PageQuery, req.query);
    return listInvoices(db, req.tenantId, { customerId: id, cursor: q.cursor, limit: q.limit });
  });
}
