-- Orders, payments and the telco customer identity. schema.sql carries the same
-- definitions for a fresh install; this file is what an existing database needs.
-- (Contents identical to the `-- commerce` block appended to schema.sql.)

-- ── commerce ───────────────────────────────────────────────────────────────
-- The telco identity, keyed by MSISDN. Distinct from `users`, which is the
-- email identity the VPN control plane authenticates — deliberately so: VPN
-- recovery has to work when the SIM is gone. `vpn_user_id` links them once we
-- know they are the same person.
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  msisdn      TEXT NOT NULL UNIQUE,
  name        TEXT,
  carrier     TEXT NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  vpn_user_id TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_carrier ON customers(carrier);

-- Amounts are whole XOF: the CFA franc has no minor unit, so scaling by 100
-- would invent precision that does not exist.
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  product        TEXT NOT NULL,          -- airtime | data | esim | vpn
  sku            TEXT,                   -- catalogue line, when it came from one
  detail         TEXT NOT NULL,          -- what the customer saw
  amount         INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'XOF',
  status         TEXT NOT NULL,          -- pending | delivered | failed | refunded
  created_at     INTEGER NOT NULL,
  delivered_at   INTEGER,
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_browse ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status, product);

-- Separate from `orders` because one order can be attempted more than once —
-- a declined mobile-money push followed by a successful retry is two payments
-- against one order, which the previous single-row model could not express.
CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id),
  provider     TEXT NOT NULL,            -- orange_money | mtn_momo | moov_money | card
  provider_ref TEXT,                     -- the provider's own transaction id
  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'XOF',
  status       TEXT NOT NULL,            -- pending | captured | failed | refunded
  created_at   INTEGER NOT NULL,
  settled_at   INTEGER,
  -- Provider callbacks retry; this makes replays a no-op rather than a
  -- duplicate capture.
  UNIQUE (provider, provider_ref)
);
CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);
