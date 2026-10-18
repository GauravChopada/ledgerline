CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants (id),
  invoice_id   TEXT NOT NULL REFERENCES invoices (id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX payments_tenant_page ON payments (tenant_id, created_at DESC, id DESC);
CREATE INDEX payments_invoice ON payments (invoice_id);
