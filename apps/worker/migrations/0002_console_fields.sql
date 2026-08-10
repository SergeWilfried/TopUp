-- Adds the columns the admin console reads. schema.sql is the fresh-install
-- baseline and uses CREATE TABLE IF NOT EXISTS, which silently does nothing on
-- a database that already has the table — so an existing deployment needs this.
ALTER TABLE users ADD COLUMN sub_started_at INTEGER;
ALTER TABLE users ADD COLUMN plan TEXT;

-- The WireGuard endpoint written into customer configs, distinct from api_url
-- (the agent's management address).
ALTER TABLE servers ADD COLUMN host TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS users_subscribed ON users(sub_expires_at);
