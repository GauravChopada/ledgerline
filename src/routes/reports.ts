import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { all, get } from '../db.ts';
import { parse } from '../http.ts';

const RevenueQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

export type RevenueRow = { month: string; currency: string; total_cents: number };

export function reportRoutes(app: FastifyInstance, { db }: Deps): void {
  // Cash received per calendar month (UTC) and currency.
  app.get('/reports/revenue', async (req) => {
    const { year } = parse(RevenueQuery, req.query);
    const from = `${year}-01-01T00:00:00.000Z`;
    const to = `${year + 1}-01-01T00:00:00.000Z`;

    const payments = all<{ invoice_id: string; amount_cents: number; created_at: string }>(
      db,
      'SELECT invoice_id, amount_cents, created_at FROM payments WHERE tenant_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at',
      req.tenantId,
      from,
      to,
    );

    const totals = new Map<string, RevenueRow>();
    for (const payment of payments) {
      const invoice = get<{ currency: string }>(db, 'SELECT currency FROM invoices WHERE id = ?', payment.invoice_id);
      if (!invoice) continue;
      const month = payment.created_at.slice(0, 7); // timestamps are stored as UTC ISO strings
      const key = `${month}:${invoice.currency}`;
      const row = totals.get(key) ?? { month, currency: invoice.currency, total_cents: 0 };
      row.total_cents += payment.amount_cents;
      totals.set(key, row);
    }

    return { year, rows: [...totals.values()] };
  });
}
