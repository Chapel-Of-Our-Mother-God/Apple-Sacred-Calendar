-- Sacred Calendar Notifications — Queue fanout migration
-- Run once against production D1 BEFORE deploying the new Worker.
-- Idempotent: CREATE IF NOT EXISTS + INSERT OR IGNORE; safe to re-run.
-- Does NOT drop or alter subscriptions, sent_log, or any existing table.

-- 1. Queue delivery state table
CREATE TABLE IF NOT EXISTS delivery_events (
  subscription_id       TEXT    NOT NULL,
  sacred_date           TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'queued',
  lease_token           TEXT,
  leased_at             INTEGER NOT NULL DEFAULT 0,
  send_started_at       INTEGER NOT NULL DEFAULT 0,
  lease_generation      INTEGER NOT NULL DEFAULT 1,
  send_attempt_count    INTEGER NOT NULL DEFAULT 0,
  claimed_queue_attempt INTEGER,
  PRIMARY KEY (subscription_id, sacred_date)
);

-- 2. Scan lock table
CREATE TABLE IF NOT EXISTS scan_state (
  lock_id         TEXT    PRIMARY KEY,
  locked_at       INTEGER NOT NULL,
  lock_expires_at INTEGER NOT NULL,
  run_id          TEXT    NOT NULL
);

-- 3. Seed delivery_events from sent_log so historical pushes are
--    marked 'delivered' and the new Worker does not re-notify.
--    INSERT OR IGNORE: re-running this migration does nothing if the row
--    already exists.
INSERT OR IGNORE INTO delivery_events (subscription_id, sacred_date, status)
SELECT subscription_id, sacred_date, 'delivered'
FROM sent_log;
