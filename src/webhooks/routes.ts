import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { type Db, get, run, tx } from '../db.ts';
import { HttpError, parse } from '../http.ts';
import { newId } from '../ids.ts';
import { Cents, Currency } from '../money.ts';
import type { Invoice } from '../routes/invoices.ts';
import { verifySignature } from './signature.ts';

const ProviderEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

const ChargeSucceeded = z.object({
  charge_id: z.string().min(1),
  amount_cents: Cents.positive(),
  currency: Currency,
  metadata: z.object({ tenant_id: z.string().min(1), invoice_id: z.string().min(1) }),
});

type Outcome = 'payment_recorded' | 'ignored';

function applyChargeSucceeded(db: Db, data: z.output<typeof ChargeSucceeded>, receivedAt: string): Outcome {
  const { tenant_id: tenantId, invoice_id: invoiceId } = data.metadata;
  const invoice = get<Invoice>(db, 'SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', invoiceId, tenantId);
  if (!invoice || invoice.status !== 'open' || invoice.currency !== data.currency) return 'ignored';
  if (data.amount_cents > invoice.total_cents - invoice.amount_paid_cents) return 'ignored';

  run(
    db,
    "INSERT INTO payments (id, tenant_id, invoice_id, amount_cents, method, created_at) VALUES (?, ?, ?, ?, 'card', ?)",
    newId('pay'),
    tenantId,
    invoiceId,
    data.amount_cents,
    receivedAt,
  );
  const paid = invoice.amount_paid_cents + data.amount_cents;
  run(
    db,
    'UPDATE invoices SET amount_paid_cents = ?, status = ? WHERE id = ?',
    paid,
    paid === invoice.total_cents ? 'paid' : 'open',
    invoiceId,
  );
  return 'payment_recorded';
}

export function webhookRoutes(app: FastifyInstance, { db, now, webhookSecret }: Deps): void {
  app.register(async (scope) => {
    // Signatures are computed over the exact bytes sent, so keep the body raw in this scope.
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    scope.post<{ Body: Buffer }>('/webhooks/provider', { config: { public: true } }, async (req, reply) => {
      const raw = req.body;
      if (webhookSecret) {
        const header = req.headers['provider-signature'];
        if (!verifySignature(raw, Array.isArray(header) ? header[0] : header, webhookSecret)) {
          throw new HttpError(400, 'invalid_signature', 'webhook signature did not verify');
        }
      } else {
        req.log.warn('PROVIDER_WEBHOOK_SECRET is not set; accepting an unsigned webhook (local development only)');
      }

      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new HttpError(400, 'invalid_json', 'body is not valid JSON');
      }
      const event = parse(ProviderEvent, json);
      const receivedAt = now().toISOString();

      const outcome = tx(db, () => {
        const seen = get(db, 'SELECT 1 FROM webhook_events WHERE id = ?', event.id);
        if (seen) return 'duplicate' as const;

        let outcome: Outcome = 'ignored';
        if (event.type === 'charge.succeeded') {
          outcome = applyChargeSucceeded(db, parse(ChargeSucceeded, event.data), receivedAt);
        }
        run(
          db,
          'INSERT INTO webhook_events (id, type, payload, outcome, received_at) VALUES (?, ?, ?, ?, ?)',
          event.id,
          event.type,
          raw.toString('utf8'),
          outcome,
          receivedAt,
        );
        return outcome;
      });

      if (outcome === 'ignored') req.log.info({ eventId: event.id, type: event.type }, 'webhook event ignored');
      return reply.code(200).send({ received: true, outcome });
    });
  });
}
