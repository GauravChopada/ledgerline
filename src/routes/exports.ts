import type { FastifyInstance } from 'fastify';
import type { SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { csvRow, formatAmount, plainText } from '../csv.ts';
import { all } from '../db.ts';
import { parse } from '../http.ts';
import { INVOICE_STATUSES } from './invoices.ts';

const ExportQuery = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  sort: z.enum(['created_at', 'issued_at', 'due_at']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const HEADER = [
  'number',
  'status',
  'customer_name',
  'customer_email',
  'currency',
  'total',
  'amount_paid',
  'amount_due',
  'issued_at',
  'due_at',
] as const;

type ExportRow = {
  number: string;
  status: string;
  customer_name: string;
  customer_email: string;
  currency: string;
  total_cents: number;
  amount_paid_cents: number;
  issued_at: string | null;
  due_at: string | null;
};

export function exportRoutes(app: FastifyInstance, { db, now }: Deps): void {
  // Built in memory: the largest tenant has a few thousand invoices.
  app.get('/invoices/export.csv', async (req, reply) => {
    const q = parse(ExportQuery, req.query);
    const where = ['i.tenant_id = ?'];
    const params: SQLInputValue[] = [req.tenantId];
    if (q.status) {
      where.push('i.status = ?');
      params.push(q.status);
    }

    // `sort` and `order` are restricted to the enums above, so interpolating them is safe.
    const rows = all<ExportRow>(
      db,
      `SELECT i.number, i.status, c.name AS customer_name, c.email AS customer_email, i.currency,
              i.total_cents, i.amount_paid_cents, i.issued_at, i.due_at
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY i.${q.sort} ${q.order} NULLS LAST, i.id ${q.order}`,
      ...params,
    );

    let csv = '﻿' + csvRow(HEADER); // BOM so Excel opens the file as UTF-8
    for (const row of rows) {
      csv += csvRow([
        row.number,
        row.status,
        plainText(row.customer_name),
        plainText(row.customer_email),
        row.currency,
        formatAmount(row.total_cents),
        formatAmount(row.amount_paid_cents),
        formatAmount(row.total_cents - row.amount_paid_cents),
        row.issued_at ?? '',
        row.due_at ?? '',
      ]);
    }

    const date = now().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="invoices-${date}.csv"`)
      .send(csv);
  });
}
