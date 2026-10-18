import { type Db, all, get } from '../db.ts';
import type { Page } from '../pagination.ts';
import { type Filter, type PageRequest, eq, oneOf, paginate } from './paginate.ts';

export const INVOICE_STATUSES = ['draft', 'open', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type Invoice = {
  id: string;
  customer_id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  total_cents: number;
  amount_paid_cents: number;
  due_at: string | null;
  issued_at: string | null;
  created_at: string;
};

export type InvoiceLine = {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unit_amount_cents: number;
};

export const INVOICE_COLUMNS =
  'id, customer_id, number, status, currency, total_cents, amount_paid_cents, due_at, issued_at, created_at';

// Voided invoices are almost never what someone listing invoices is looking for.
const LISTED_BY_DEFAULT: readonly InvoiceStatus[] = ['draft', 'open', 'paid'];

export type ListInvoicesOptions = PageRequest & {
  status?: InvoiceStatus | readonly InvoiceStatus[];
  customerId?: string;
};

/** Newest first. */
export function listInvoices(
  db: Db,
  tenantId: string,
  { status = LISTED_BY_DEFAULT, customerId, ...page }: ListInvoicesOptions,
): Page<Invoice> {
  const filters: Filter[] = [eq('tenant_id', tenantId)];
  filters.push(typeof status === 'string' ? eq('status', status) : oneOf('status', status));
  if (customerId) filters.push(eq('customer_id', customerId));
  return paginate<Invoice>(db, 'invoices', INVOICE_COLUMNS, filters, page);
}

export function getInvoice(db: Db, tenantId: string, id: string): (Invoice & { lines: InvoiceLine[] }) | undefined {
  const invoice = get<Invoice>(db, `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = ? AND tenant_id = ?`, id, tenantId);
  if (!invoice) return undefined;
  const lines = all<InvoiceLine>(
    db,
    'SELECT id, position, description, quantity, unit_amount_cents FROM invoice_lines WHERE invoice_id = ? ORDER BY position',
    id,
  );
  return { ...invoice, lines };
}
