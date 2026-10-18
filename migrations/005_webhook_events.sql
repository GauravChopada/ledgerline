-- Every event received from the payment provider, keyed by the provider's event id so
-- redeliveries are recognised.
CREATE TABLE webhook_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  received_at  TEXT NOT NULL
);
