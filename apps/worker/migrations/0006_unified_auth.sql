-- One account reachable by phone or email, plus a staff flag.
--
-- The console had no authentication at all: anyone who could reach /admin could
-- read every customer and mint VPN endpoints (which store agent tokens).

ALTER TABLE users ADD COLUMN msisdn TEXT;
ALTER TABLE users ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS users_msisdn ON users(msisdn);

-- `email` becomes optional: a phone-only customer has no address yet. SQLite
-- cannot drop NOT NULL in place, so a fresh install uses schema.sql; existing
-- databases keep the constraint until the table is rebuilt.

ALTER TABLE otp_codes RENAME COLUMN email TO identifier;
ALTER TABLE otp_codes ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
