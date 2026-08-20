-- The phone farm: devices that dispatch airtime over USSD.
--
-- Buying from the operator directly pays 7% against a distributor's 2%, but
-- the operator's channel is a person on a handset typing a USSD menu. These
-- two tables turn that into a queue: the worker decides what should be sent,
-- and a device on a merchant SIM claims one job at a time and does the typing.
--
-- One row per SIM, because credit transfer does not cross networks and a job
-- must reach a device holding the right operator's card.
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  label         TEXT,
  msisdn        TEXT NOT NULL UNIQUE,
  carrier       TEXT NOT NULL,
  country       TEXT NOT NULL,
  -- Per-device, not a shared secret: one compromised handset is revoked on its
  -- own rather than re-keying the whole farm. Stored as a hash, like sessions.
  token_hash    TEXT NOT NULL UNIQUE,
  active        INTEGER NOT NULL DEFAULT 1,
  -- What the SIM last reported it was holding. A device with less float than a
  -- job needs must not be handed that job.
  float_balance INTEGER,
  -- Operators cap transfers per line per day; the worker refuses to lease past
  -- the cap rather than letting the device discover it mid-menu.
  daily_cap     INTEGER,
  daily_count   INTEGER NOT NULL DEFAULT 0,
  daily_reset_at INTEGER NOT NULL DEFAULT 0,
  last_seen     INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_route ON agents(country, carrier, active);

-- One dispatch attempt for one order.
--
-- `order_id` is UNIQUE, which is the idempotency guarantee: a redelivery of an
-- order that already has a job cannot create a second one, so a retried
-- delivery call can never queue the same top-up twice.
CREATE TABLE IF NOT EXISTS delivery_jobs (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  agent_id      TEXT REFERENCES agents(id),
  carrier       TEXT NOT NULL,
  country       TEXT NOT NULL,
  msisdn        TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  -- queued  → nobody has it
  -- leased  → a device is typing it right now
  -- sent    → the device saw the operator confirm
  -- failed  → the device saw the operator refuse
  -- unknown → nobody can say. Never re-queued. See the lease note below.
  status        TEXT NOT NULL DEFAULT 'queued',
  lease_expires_at INTEGER,
  provider_ref  TEXT,
  raw_response  TEXT,
  failure_reason TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON delivery_jobs(status, country, carrier, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_lease ON delivery_jobs(status, lease_expires_at);
