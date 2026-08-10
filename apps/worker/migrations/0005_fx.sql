-- Billing currencies for the non-XOF rails.

-- ── FX ─────────────────────────────────────────────────────────────────────
-- Catalogue prices are XOF; Stripe and Paystack cannot settle XOF, so a rate
-- is needed per billing currency. `per_xof` is how many units one franc buys.
-- EUR is a hard peg (655.957 XOF = 1 EUR) and never changes; the rest float and
-- must be refreshed from a feed — a stale rate silently mis-prices every sale.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency   TEXT PRIMARY KEY,
  per_xof    REAL NOT NULL,
  pegged     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
