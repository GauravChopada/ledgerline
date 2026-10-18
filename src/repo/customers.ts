import { type Db, get, run } from '../db.ts';
import { newId } from '../ids.ts';
import type { Page } from '../pagination.ts';
import { type PageRequest, eq, paginate } from './paginate.ts';

export type Customer = {
  id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
};

const COLUMNS = 'id, name, email, created_at, updated_at';

export function getCustomer(db: Db, tenantId: string, id: string): Customer | undefined {
  return get<Customer>(db, `SELECT ${COLUMNS} FROM customers WHERE id = ? AND tenant_id = ?`, id, tenantId);
}

export function listCustomers(db: Db, tenantId: string, page: PageRequest): Page<Customer> {
  return paginate<Customer>(db, 'customers', COLUMNS, [eq('tenant_id', tenantId)], page);
}

export function insertCustomer(db: Db, tenantId: string, input: { name: string; email: string }, now: Date): Customer {
  const timestamp = now.toISOString();
  const customer: Customer = { id: newId('cus'), ...input, created_at: timestamp, updated_at: timestamp };
  run(
    db,
    'INSERT INTO customers (id, tenant_id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    customer.id,
    tenantId,
    customer.name,
    customer.email,
    customer.created_at,
    customer.updated_at,
  );
  return customer;
}

export function updateCustomer(db: Db, tenantId: string, existing: Customer, changes: Partial<Pick<Customer, 'name' | 'email'>>, now: Date): Customer {
  const updated: Customer = { ...existing, ...changes, updated_at: now.toISOString() };
  run(
    db,
    'UPDATE customers SET name = ?, email = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
    updated.name,
    updated.email,
    updated.updated_at,
    existing.id,
    tenantId,
  );
  return updated;
}
