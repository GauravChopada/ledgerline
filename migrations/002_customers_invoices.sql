CREATE TABLE customers (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants (id),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX customers_tenant_page ON customers (tenant_id, created_at DESC, id DESC);

CREATE TABLE invoices (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants (id),
  customer_id       TEXT NOT NULL REFERENCES customers (id),
  number            TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void')),
  currency          TEXT NOT NULL,
  total_cents       INTEGER NOT NULL CHECK (total_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  due_at            TEXT,
  issued_at         TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (tenant_id, number)
);

CREATE INDEX invoices_tenant_page ON invoices (tenant_id, created_at DESC, id DESC);
CREATE INDEX invoices_customer ON invoices (customer_id);

CREATE TABLE invoice_lines (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  description       TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_amount_cents INTEGER NOT NULL CHECK (unit_amount_cents >= 0)
);
