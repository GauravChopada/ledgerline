CREATE TABLE tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE api_keys (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants (id),
  key_hash   TEXT NOT NULL UNIQUE,
  label      TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
