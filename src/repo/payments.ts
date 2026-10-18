import type { Db } from '../db.ts';
import type { Page } from '../pagination.ts';
import { type PageRequest, eq, paginate } from './paginate.ts';

export type Payment = {
  id: string;
  invoice_id: string;
  amount_cents: number;
  method: string;
  created_at: string;
};

export const PAYMENT_COLUMNS = 'id, invoice_id, amount_cents, method, created_at';

export function listPayments(db: Db, tenantId: string, page: PageRequest): Page<Payment> {
  return paginate<Payment>(db, 'payments', PAYMENT_COLUMNS, [eq('tenant_id', tenantId)], page);
}
