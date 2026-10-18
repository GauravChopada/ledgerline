import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { IdParams, notFound, parse } from '../http.ts';
import { PageQuery } from '../pagination.ts';
import { getCustomer, insertCustomer, listCustomers, updateCustomer } from '../repo/customers.ts';
import { listInvoices } from '../repo/invoices.ts';

const CreateCustomer = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
});

const UpdateCustomer = CreateCustomer.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'provide at least one field to update',
});

export function customerRoutes(app: FastifyInstance, { db, now }: Deps): void {
  app.post('/customers', async (req, reply) => {
    const body = parse(CreateCustomer, req.body);
    return reply.code(201).send(insertCustomer(db, req.tenantId, body, now()));
  });

  app.get('/customers', async (req) => {
    return listCustomers(db, req.tenantId, parse(PageQuery, req.query));
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
    return updateCustomer(db, req.tenantId, existing, body, now());
  });

  // Statement view: every invoice the customer has ever been sent, whatever its status.
  app.get('/customers/:id/invoices', async (req) => {
    const { id } = parse(IdParams, req.params);
    if (!getCustomer(db, req.tenantId, id)) throw notFound('customer');
    const q = parse(PageQuery, req.query);
    return listInvoices(db, req.tenantId, { customerId: id, cursor: q.cursor, limit: q.limit });
  });
}
