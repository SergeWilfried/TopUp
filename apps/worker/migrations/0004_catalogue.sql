-- Catalogue as records. schema.sql carries the same definitions for a fresh
-- install; this is what an existing database needs.

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
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS products_browse ON products(type, enabled, sort_order);
CREATE INDEX IF NOT EXISTS products_country ON products(country);
