-- eSIM profiles the customer owns, and which profile an order targets.
--
-- Until now an eSIM existed only on the handset that bought it — the app
-- invented a row after payment and lost it on relaunch. The provider (Yesim)
-- issues a real profile with an ICCID and an LPA activation code; that is
-- what a customer needs to install it, re-install it on a new phone, or top it
-- up, so it lives here, keyed by ICCID, refreshed from the provider on read.
CREATE TABLE IF NOT EXISTS esims (
  iccid              TEXT PRIMARY KEY,
  customer_id        TEXT,                    -- customers.id; null until known
  order_id           TEXT,                    -- the order that issued it
  provider           TEXT NOT NULL DEFAULT 'yesim',
  provider_esim_id   TEXT,                    -- provider's own row id
  plan_id            TEXT,                    -- provider plan currently on it
  label              TEXT,                    -- what the customer bought, for lists
  country            TEXT,                    -- ISO-2 destination
  qrcode             TEXT,                    -- LPA:1$smdp$code — what a QR encodes
  ios_tap_link       TEXT,                    -- one-tap install on iOS 17.4+
  passport_url       TEXT,                    -- provider's end-user page; secret link
  status_qr          TEXT,                    -- Released | Enabled | Deleted …
  plan_activated_at  TEXT,
  plan_expired_at    TEXT,
  data_package_mb    REAL,
  data_left_mb       REAL,
  data_used_mb       REAL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  synced_at          INTEGER
);
CREATE INDEX IF NOT EXISTS esims_customer ON esims(customer_id);
CREATE INDEX IF NOT EXISTS esims_order ON esims(order_id);

-- A top-up names the profile it goes on; a first purchase leaves this null and
-- delivery fills it in once the provider has issued one.
ALTER TABLE orders ADD COLUMN esim_iccid TEXT;
