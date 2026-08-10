-- When we last asked the provider about this payment.
--
-- The status endpoint now reconciles on read, so a lost callback no longer
-- strands a customer watching a spinner. Without this column every poll from
-- every client would be a provider API call; with it, reconciliation is at most
-- once every few seconds per payment however hard anyone polls.
ALTER TABLE payments ADD COLUMN checked_at INTEGER;
