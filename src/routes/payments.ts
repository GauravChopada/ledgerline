import type { FastifyInstance } from 'fastify';
import type { SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { all, get, run, tx } from '../db.ts';
import { HttpError, IdParams, notFound, parse } from '../http.ts';
import { newId } from '../ids.ts';
import { Cents } from '../money.ts';
import { PageQuery, decodeCursor, toPage } from '../pagination.ts';
import type { Invoice } from './invoices.ts';

export type Payment = {
  id: string;
  invoice_id: string;
  amount_cents: number;
  method: string;
  created_at: string;
};

const COLUMNS = 'id, invoice_id, amount_cents, method, created_at';

const PaymentMethod = z.enum(['bank_transfer', 'card', 'cash', 'other']);

// `?method=cash` or `?method=cash&method=card`
const ListPaymentsQuery = PageQuery.extend({
  method: z.union([PaymentMethod, z.array(PaymentMethod).min(1)]).optional(),
});

const RecordPayment = z.object({
  amount_cents: Cents.positive(),
  method: PaymentMethod,
});

export function paymentRoutes(app: FastifyInstance, { db, now }: Deps): void {
  app.post('/invoices/:id/payments', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(RecordPayment, req.body);

    const payment = tx(db, () => {
      const invoice = get<Invoice>(db, 'SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', id, req.tenantId);
      if (!invoice) throw notFound('invoice');
      if (invoice.status !== 'open') throw new HttpError(409, 'invalid_state', `invoice is ${invoice.status}`);

      const due = invoice.total_cents - invoice.amount_paid_cents;
      if (body.amount_cents > due) {
        throw new HttpError(422, 'overpayment', `amount exceeds the ${due} cents still due`);
      }

      const payment: Payment = {
        id: newId('pay'),
        invoice_id: id,
        amount_cents: body.amount_cents,
        method: body.method,
        created_at: now().toISOString(),
      };
      run(
        db,
        'INSERT INTO payments (id, tenant_id, invoice_id, amount_cents, method, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        payment.id,
        req.tenantId,
        id,
        payment.amount_cents,
        payment.method,
        payment.created_at,
      );

      const paid = invoice.amount_paid_cents + body.amount_cents;
      run(
        db,
        'UPDATE invoices SET amount_paid_cents = ?, status = ? WHERE id = ?',
        paid,
        paid === invoice.total_cents ? 'paid' : 'open',
        id,
      );
      return payment;
    });

    return reply.code(201).send(payment);
  });

  app.get('/payments', async (req) => {
    const q = parse(ListPaymentsQuery, req.query);
    const where = ['tenant_id = ?'];
    const params: SQLInputValue[] = [req.tenantId];
    if (q.method) {
      const methods = Array.isArray(q.method) ? q.method : [q.method];
      where.push(`method IN (${methods.map(() => '?').join(', ')})`);
      params.push(...methods);
    }
    if (q.cursor) {
      const cursor = decodeCursor(q.cursor);
      where.push('(created_at, id) < (?, ?)');
      params.push(cursor.createdAt, cursor.id);
    }
    const rows = all<Payment>(
      db,
      `SELECT ${COLUMNS} FROM payments WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      ...params,
      q.limit + 1,
    );
    return toPage(rows, q.limit);
  });
}
