import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { all } from '../db.ts';
import { parse } from '../http.ts';

const RevenueQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

export type RevenueRow = { month: string; currency: string; total_cents: number };

export function reportRoutes(app: FastifyInstance, { db }: Deps): void {
  // Cash received per calendar month and currency. Every month of the year is present (zero when
  // nothing came in) so the dashboard chart can plot the response directly.
  app.get('/reports/revenue', async (req) => {
    const { year } = parse(RevenueQuery, req.query);
    const from = `${year}-01-01T00:00:00.000Z`;
    const to = `${year + 1}-01-01T00:00:00.000Z`;

    // One query instead of one invoice lookup per payment.
    const payments = all<{ amount_cents: number; created_at: string; currency: string }>(
      db,
      `SELECT p.amount_cents, p.created_at, i.currency
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE p.tenant_id = ? AND p.created_at >= ? AND p.created_at < ?`,
      req.tenantId,
      from,
      to,
    );

    const byCurrency = new Map<string, number[]>();
    for (const payment of payments) {
      const months = byCurrency.get(payment.currency) ?? Array.from({ length: 12 }, () => 0);
      const month = new Date(payment.created_at).getMonth();
      months[month] = (months[month] ?? 0) + payment.amount_cents;
      byCurrency.set(payment.currency, months);
    }

    const rows: RevenueRow[] = [];
    for (const [currency, months] of [...byCurrency].sort(([a], [b]) => a.localeCompare(b))) {
      months.forEach((total, index) => {
        rows.push({ month: `${year}-${String(index + 1).padStart(2, '0')}`, currency, total_cents: total });
      });
    }
    return { year, rows };
  });
}
