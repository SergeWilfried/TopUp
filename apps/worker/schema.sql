-- VPN control plane schema.
--
-- Every instant is stored as INTEGER epoch milliseconds. The previous version
-- mixed JS `toISOString()` ("2026-08-09T10:10:00.000Z") with SQLite's
-- `datetime('now')` ("2026-08-09 10:10:00") and compared them as TEXT — 'T'
-- sorts above ' ', so any row whose date part matched today always compared as
-- "not yet expired". OTPs effectively lived until midnight UTC. Integers make
-- the comparison numeric and unambiguous.

-- One account, two ways in: the app signs in with a phone number, the console
-- and VPN recovery with an email. Either identifier resolves to the same row,
-- so a customer who bought airtime on their handset and a VPN by email is one
-- person rather than two.
CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  email              TEXT UNIQUE,
  msisdn             TEXT UNIQUE,
  is_staff           INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT UNIQUE,
  sub_expires_at     INTEGER,               -- epoch ms, NULL = never subscribed
  sub_started_at     INTEGER,               -- first grant, for "Started" in the console
  plan               TEXT,                  -- plan name as sold, from Stripe metadata
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_subscribed ON users(sub_expires_at);

-- Session tokens are stored hashed: a database leak should not hand over
-- usable credentials. The plaintext token is returned to the client once.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

-- One live challenge per address. `attempts` closes the brute-force window;
-- `send_count`/`window_started_at` throttle resends so the endpoint cannot be
-- used to bomb an inbox.
-- Keyed by whatever was used to request the code — an email or an MSISDN.
CREATE TABLE IF NOT EXISTS otp_codes (
  identifier        TEXT PRIMARY KEY,
  channel           TEXT NOT NULL DEFAULT 'email',
  code_hash         TEXT NOT NULL,
  expires_at        INTEGER NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  send_count        INTEGER NOT NULL DEFAULT 1,
  window_started_at INTEGER NOT NULL
);

-- Per-server credentials: one shared AGENT_TOKEN meant that compromising any
-- single VPS handed over peer management on all of them.
-- `host` is the WireGuard endpoint written into customer configs; `api_url` is
-- the agent's management address. They are different things and the console
-- previously conflated them.
CREATE TABLE IF NOT EXISTS servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  host        TEXT NOT NULL DEFAULT '',
  api_url     TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

-- `state` drives reconciliation:
--   reserving     – slot taken, agent call in flight (counts toward the limit)
--   active        – agent and D1 agree
--   pending_delete– exists on the agent, must be removed; the cron retries
CREATE TABLE IF NOT EXISTS peers (
  public_key TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id  TEXT NOT NULL REFERENCES servers(id),
  address    TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  state      TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS peers_user_server ON peers(user_id, server_id, state);
CREATE INDEX IF NOT EXISTS peers_sweep ON peers(state, enabled);

-- Stripe redelivers. Without this table a retry extended the subscription a
-- second time, and `checkout.session.completed` + `invoice.paid` both firing
-- for one payment granted 60 days.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

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
  status         TEXT NOT NULL,          -- pending | paid | delivering | delivered
                                         --   | delivery_failed | delivery_unknown | failed | refunded
  created_at     INTEGER NOT NULL,
  delivered_at   INTEGER,
  recipient_msisdn TEXT,
  recipient_country TEXT,
  delivery_provider TEXT,
  delivery_ref     TEXT,
  delivery_error   TEXT,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_checked_at INTEGER,
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
  provider     TEXT NOT NULL,            -- pawapay | paystack | stripe
  provider_ref TEXT,                     -- the provider's own transaction id
  -- ISO 4217 minor units of `currency`: cents for EUR, whole francs for XOF.
  -- Providers disagree on this (Paystack multiplies everything by 100), so each
  -- provider module normalises to ISO before anything is compared here.
  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'XOF',
  status       TEXT NOT NULL,            -- pending | captured | failed | refunded
  created_at   INTEGER NOT NULL,
  settled_at   INTEGER,
  -- Last time the provider was asked about this payment, so reconciling on read
  -- cannot turn client polling into one API call per poll.
  checked_at   INTEGER,
  -- Provider callbacks retry; this makes replays a no-op rather than a
  -- duplicate capture.
  UNIQUE (provider, provider_ref)
);
CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);

-- ── catalogue ──────────────────────────────────────────────────────────────
-- Prose is stored as a translation key plus its params and resolved per
-- request; units and proper nouns are stored literally. A row created by an
-- operator has no key and falls back to the literal text it was given.
CREATE TABLE IF NOT EXISTS destinations (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  coverage     TEXT NOT NULL DEFAULT '',
  coverage_key TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  name         TEXT NOT NULL,
  name_key     TEXT,
  country      TEXT,
  network      TEXT,
  terms        TEXT NOT NULL DEFAULT '',
  terms_key    TEXT,
  terms_params TEXT,
  bonus        TEXT,
  bonus_key    TEXT,
  price        INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'XOF',
  days         INTEGER,
  bundle_id    TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS products_browse ON products(type, enabled, sort_order);
CREATE INDEX IF NOT EXISTS products_country ON products(country);

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
