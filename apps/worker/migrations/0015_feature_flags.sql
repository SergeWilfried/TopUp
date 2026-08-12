-- Per-market feature switches.
--
-- A corridor breaks in one country at a time: a distributor loses its float in
-- Burkina, an operator changes a bundle format in Senegal, a payment rail goes
-- down in Côte d'Ivoire. Without this the only remedies are a deploy or leaving
-- customers to hit failures, and neither is fast enough at the moment it
-- matters.
--
-- `country` holds an ISO-2 code, or '*' for the default that applies wherever
-- no country-specific row exists. Storing the default as an ordinary row means
-- "off everywhere except Burkina" is two rows rather than a special case in
-- code.
CREATE TABLE IF NOT EXISTS feature_flags (
  feature    TEXT NOT NULL,
  country    TEXT NOT NULL,          -- ISO-2, or '*' for every market
  enabled    INTEGER NOT NULL,       -- 0 | 1
  note       TEXT,                   -- why it was flipped, for whoever finds it later
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (feature, country)
);

-- Every lookup is "this feature, this country, plus the default", so the
-- primary key already serves it. No secondary index earns its keep here.
