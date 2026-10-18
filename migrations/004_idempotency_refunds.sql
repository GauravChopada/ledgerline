-- Responses to requests sent with an Idempotency-Key header, replayed on retry.
CREATE TABLE idempotency_keys (
  tenant_id   TEXT NOT NULL REFERENCES tenants (id),
  key         TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status      INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX idempotency_keys_lookup ON idempotency_keys (tenant_id, key);

ALTER TABLE payments ADD COLUMN provider_charge_id TEXT;
ALTER TABLE payments ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0);

CREATE TABLE refunds (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants (id),
  payment_id   TEXT NOT NULL REFERENCES payments (id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason       TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX refunds_payment ON refunds (payment_id);
