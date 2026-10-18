import type { FastifyInstance } from 'fastify';
import type { SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { type Db, all, get, run, tx } from '../db.ts';
import { HttpError, IdParams, notFound, parse } from '../http.ts';
import { idempotencyKey, withIdempotency } from '../idempotency.ts';
import { newId } from '../ids.ts';
import { Cents } from '../money.ts';
import { PageQuery, decodeCursor, toPage } from '../pagination.ts';
import type { Invoice } from './invoices.ts';

export type Payment = {
  id: string;
  invoice_id: string;
  amount_cents: number;
  refunded_cents: number;
  method: string;
  provider_charge_id: string | null;
  created_at: string;
};

export type Refund = {
  id: string;
  payment_id: string;
  amount_cents: number;
  reason: string | null;
  created_at: string;
};

const COLUMNS = 'id, invoice_id, amount_cents, refunded_cents, method, provider_charge_id, created_at';

const RecordPayment = z
  .object({
    amount_cents: Cents.positive(),
    method: z.enum(['bank_transfer', 'card', 'cash', 'other']),
    source: z.string().min(1).optional(),
  })
  .refine((p) => p.method !== 'card' || p.source !== undefined, {
    message: 'source is required for card payments',
    path: ['source'],
  });

const CreateRefund = z.object({
  // The dashboard sends refund amounts the way the user typed them, in major units (19.99).
  amount: z.number().positive(),
  reason: z.string().trim().max(500).optional(),
});

function payableInvoice(db: Db, tenantId: string, invoiceId: string, amountCents: number): Invoice {
  const invoice = get<Invoice>(db, 'SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', invoiceId, tenantId);
  if (!invoice) throw notFound('invoice');
  if (invoice.status !== 'open') throw new HttpError(409, 'invalid_state', `invoice is ${invoice.status}`);
  const due = invoice.total_cents - invoice.amount_paid_cents;
  if (amountCents > due) throw new HttpError(422, 'overpayment', `amount exceeds the ${due} cents still due`);
  return invoice;
}

export function paymentRoutes(app: FastifyInstance, { db, now, provider }: Deps): void {
  app.post('/invoices/:id/payments', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(RecordPayment, req.body);
    const key = idempotencyKey(req);

    const result = await withIdempotency(db, req.tenantId, key, { op: 'record_payment', id, body }, now, async () => {
      const invoice = payableInvoice(db, req.tenantId, id, body.amount_cents);

      let chargeId: string | null = null;
      if (body.method === 'card' && body.source) {
        const charge = await provider.charge({
          amountCents: body.amount_cents,
          currency: invoice.currency,
          source: body.source,
          description: `Invoice ${invoice.number}`,
        });
        chargeId = charge.chargeId;
      }

      try {
        const payment = tx(db, () => {
          // Re-check: the invoice may have changed while the card was being charged.
          const current = payableInvoice(db, req.tenantId, id, body.amount_cents);
          const payment: Payment = {
            id: newId('pay'),
            invoice_id: id,
            amount_cents: body.amount_cents,
            refunded_cents: 0,
            method: body.method,
            provider_charge_id: chargeId,
            created_at: now().toISOString(),
          };
          run(
            db,
            `INSERT INTO payments (id, tenant_id, invoice_id, amount_cents, method, provider_charge_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            payment.id,
            req.tenantId,
            id,
            payment.amount_cents,
            payment.method,
            chargeId,
            payment.created_at,
          );
          const paid = current.amount_paid_cents + body.amount_cents;
          run(
            db,
            'UPDATE invoices SET amount_paid_cents = ?, status = ? WHERE id = ?',
            paid,
            paid === current.total_cents ? 'paid' : 'open',
            id,
          );
          return payment;
        });
        return { status: 201, body: payment };
      } catch (err) {
        // Never keep money we could not record.
        if (chargeId) await provider.refund(chargeId, body.amount_cents);
        throw err;
      }
    });

    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return reply.code(result.status).send(result.body);
  });

  app.post('/payments/:id/refunds', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(CreateRefund, req.body);
    const amountCents = Math.trunc(body.amount * 100); // drop anything below a cent

    const refund = tx(db, () => {
      const payment = get<Payment>(db, `SELECT ${COLUMNS} FROM payments WHERE id = ?`, id);
      if (!payment) throw notFound('payment');
      const refundable = payment.amount_cents - payment.refunded_cents;
      if (amountCents < 1 || amountCents > refundable) {
        throw new HttpError(422, 'invalid_refund_amount', `between 1 and ${refundable} cents can be refunded`);
      }

      const refund: Refund = {
        id: newId('ref'),
        payment_id: id,
        amount_cents: amountCents,
        reason: body.reason ?? null,
        created_at: now().toISOString(),
      };
      run(
        db,
        'INSERT INTO refunds (id, tenant_id, payment_id, amount_cents, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        refund.id,
        req.tenantId,
        id,
        amountCents,
        refund.reason,
        refund.created_at,
      );
      run(db, 'UPDATE payments SET refunded_cents = refunded_cents + ? WHERE id = ?', amountCents, id);
      run(
        db,
        `UPDATE invoices SET amount_paid_cents = amount_paid_cents - ?,
                             status = CASE WHEN status = 'paid' THEN 'open' ELSE status END
         WHERE id = ?`,
        amountCents,
        payment.invoice_id,
      );
      return { refund, chargeId: payment.provider_charge_id, invoiceId: payment.invoice_id };
    });

    if (refund.chargeId) {
      try {
        await provider.refund(refund.chargeId, amountCents);
      } catch (err) {
        // The gateway refused: roll the bookkeeping back so the ledger matches the card.
        tx(db, () => {
          run(db, 'DELETE FROM refunds WHERE id = ?', refund.refund.id);
          run(db, 'UPDATE payments SET refunded_cents = refunded_cents - ? WHERE id = ?', amountCents, id);
          run(
            db,
            `UPDATE invoices SET amount_paid_cents = amount_paid_cents + ?,
                                 status = CASE WHEN amount_paid_cents + ? = total_cents THEN 'paid' ELSE status END
             WHERE id = ?`,
            amountCents,
            amountCents,
            refund.invoiceId,
          );
        });
        throw err;
      }
    }

    return reply.code(201).send(refund.refund);
  });

  app.get('/payments', async (req) => {
    const q = parse(PageQuery, req.query);
    const where = ['tenant_id = ?'];
    const params: SQLInputValue[] = [req.tenantId];
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
