-- Handset compatibility, on both sides of the question.
--
-- `esim_devices` is the provider's published list of models it will install
-- onto, kept locally so a purchase can be checked without a round trip to
-- them. `model_norm` is the join key: lowercase, parentheticals stripped,
-- indexed under both "galaxy a36" and "samsung galaxy a36" because the feed is
-- inconsistent about whether the maker is part of the model.
CREATE TABLE IF NOT EXISTS esim_devices (
  model_norm TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  brand      TEXT NOT NULL,
  model      TEXT NOT NULL,
  synced_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_esim_devices_brand ON esim_devices(brand);

-- `device_seen` is the other half, and the one no provider can give us: what
-- our own customers are holding. The provider's list says whether a Galaxy A36
-- can take an eSIM; only this says how many of our users own one.
--
-- Keyed by an install id the app generates locally and never links to a person
-- — no msisdn, no account, no advertising identifier — so the table answers a
-- market-sizing question without becoming a tracking log. Repeat launches
-- update `last_seen` rather than inflating the count.
CREATE TABLE IF NOT EXISTS device_seen (
  install_id   TEXT PRIMARY KEY,
  brand        TEXT,
  model        TEXT,
  model_norm   TEXT,
  os_name      TEXT,
  os_version   TEXT,
  country      TEXT,
  -- 1 when the provider lists this model. Left NULL when it does not, because
  -- absence from a curated list is not evidence of incapability — 0 would
  -- claim more than we know.
  esim_capable INTEGER,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_seen_brand ON device_seen(brand, model);
