-- Delivery is its own step, not a side effect of payment.
--
-- Capturing a payment used to write `delivered` straight onto the order, so the
-- console counted money taken as goods shipped and a failed top-up was
-- indistinguishable from a successful one. The lifecycle is now
--   pending → paid → delivering → delivered | delivery_failed | delivery_unknown
-- with `delivery_unknown` for outcomes we genuinely do not know: a timeout, or
-- later a dropped USSD session after the PIN. Those are never auto-retried.
ALTER TABLE orders ADD COLUMN delivery_provider TEXT;
ALTER TABLE orders ADD COLUMN delivery_ref TEXT;
ALTER TABLE orders ADD COLUMN delivery_error TEXT;
ALTER TABLE orders ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN delivery_checked_at INTEGER;

CREATE INDEX IF NOT EXISTS orders_delivery_sweep
  ON orders(status, delivery_checked_at);
