import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { get, run, tx } from '../db.ts';
import { HttpError, IdParams, notFound, parse } from '../http.ts';
import { newId } from '../ids.ts';
import { Cents, Currency, lineTotal, sumCents } from '../money.ts';
import { PageQuery } from '../pagination.ts';
import { INVOICE_STATUSES, getInvoice, listInvoices } from '../repo/invoices.ts';

const LineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive().max(1_000_000),
  unit_amount_cents: Cents,
});

const CreateInvoice = z.object({
  customer_id: z.string().min(1),
  currency: Currency,
  due_at: z.iso.datetime().optional(),
  lines: z.array(LineInput).min(1).max(100),
});

const ListInvoicesQuery = PageQuery.extend({ status: z.enum(INVOICE_STATUSES).optional() });

export function invoiceRoutes(app: FastifyInstance, { db, now }: Deps): void {
  app.post('/invoices', async (req, reply) => {
    const body = parse(CreateInvoice, req.body);
    const id = newId('inv');

    tx(db, () => {
      const customer = get(db, 'SELECT 1 FROM customers WHERE id = ? AND tenant_id = ?', body.customer_id, req.tenantId);
      if (!customer) throw notFound('customer');

      const { count } = get<{ count: number }>(
        db,
        'SELECT COUNT(*) AS count FROM invoices WHERE tenant_id = ?',
        req.tenantId,
      ) ?? { count: 0 };
      const number = `INV-${String(count + 1).padStart(4, '0')}`;
      const totals = body.lines.map((line) => lineTotal(line.quantity, line.unit_amount_cents));

      run(
        db,
        `INSERT INTO invoices (id, tenant_id, customer_id, number, status, currency, total_cents, due_at, created_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        id,
        req.tenantId,
        body.customer_id,
        number,
        body.currency,
        sumCents(totals),
        body.due_at ?? null,
        now().toISOString(),
      );
      body.lines.forEach((line, position) => {
        run(
          db,
          'INSERT INTO invoice_lines (id, invoice_id, position, description, quantity, unit_amount_cents) VALUES (?, ?, ?, ?, ?, ?)',
          newId('lin'),
          id,
          position,
          line.description,
          line.quantity,
          line.unit_amount_cents,
        );
      });
    });

    return reply.code(201).send(getInvoice(db, req.tenantId, id));
  });

  app.get('/invoices', async (req) => {
    const q = parse(ListInvoicesQuery, req.query);
    return listInvoices(db, req.tenantId, q);
  });

  app.get('/invoices/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const invoice = getInvoice(db, req.tenantId, id);
    if (!invoice) throw notFound('invoice');
    return invoice;
  });

  app.post('/invoices/:id/finalize', async (req) => {
    const { id } = parse(IdParams, req.params);
    tx(db, () => {
      const invoice = getInvoice(db, req.tenantId, id);
      if (!invoice) throw notFound('invoice');
      if (invoice.status !== 'draft') throw new HttpError(409, 'invalid_state', `invoice is ${invoice.status}`);
      if (invoice.total_cents === 0) throw new HttpError(422, 'empty_invoice', 'cannot finalize a zero-total invoice');
      run(db, "UPDATE invoices SET status = 'open', issued_at = ? WHERE id = ?", now().toISOString(), id);
    });
    return getInvoice(db, req.tenantId, id);
  });

  app.post('/invoices/:id/void', async (req) => {
    const { id } = parse(IdParams, req.params);
    tx(db, () => {
      const invoice = getInvoice(db, req.tenantId, id);
      if (!invoice) throw notFound('invoice');
      if (invoice.status === 'paid' || invoice.status === 'void') {
        throw new HttpError(409, 'invalid_state', `invoice is ${invoice.status}`);
      }
      if (invoice.amount_paid_cents > 0) {
        throw new HttpError(409, 'has_payments', 'refund recorded payments before voiding');
      }
      run(db, "UPDATE invoices SET status = 'void' WHERE id = ?", id);
    });
    return getInvoice(db, req.tenantId, id);
  });
}
