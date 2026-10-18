import type { Db } from './db.ts';
import { type Customer, getCustomer } from './routes/customers.ts';

export type CustomerSummary = Pick<Customer, 'id' | 'name' | 'email'>;

// Customer details change rarely and are read on every invoice list, so keep them in memory
// instead of querying once per invoice.
const cache = new Map<string, CustomerSummary>();

export function customerSummary(db: Db, tenantId: string, customerId: string): CustomerSummary | null {
  const key = `${tenantId}:${customerId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const customer = getCustomer(db, tenantId, customerId);
  if (!customer) return null;
  const summary = { id: customer.id, name: customer.name, email: customer.email };
  cache.set(key, summary);
  return summary;
}
