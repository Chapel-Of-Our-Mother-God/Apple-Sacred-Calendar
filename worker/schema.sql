-- Sacred Calendar Notifications — D1 schema
-- Apply with: wrangler d1 execute sacred-calendar-notifications --file=schema.sql

CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT    PRIMARY KEY,          -- UUID v4 assigned at subscribe time
  endpoint        TEXT    NOT NULL UNIQUE,      -- push service URL
  p256dh          TEXT    NOT NULL,             -- client public key, base64url
  auth            TEXT    NOT NULL,             -- auth secret, base64url
  timezone        TEXT    NOT NULL DEFAULT 'UTC',
  silent_supported INTEGER NOT NULL DEFAULT 0, -- 1 = 'silent' in Notification.prototype
  next_push_at_utc INTEGER NOT NULL,           -- Unix epoch ms; cron fires when <= now
  created_at      INTEGER NOT NULL             -- Unix epoch ms
);

CREATE INDEX IF NOT EXISTS idx_next_push
  ON subscriptions (next_push_at_utc);

-- Idempotency fence: one push per (subscription × effective local date).
-- sacred_date is the YYYY-MM-DD of the effective local date in the subscriber's timezone.
CREATE TABLE IF NOT EXISTS sent_log (
  subscription_id TEXT NOT NULL,
  sacred_date     TEXT NOT NULL,
  PRIMARY KEY (subscription_id, sacred_date)
);

-- Queue delivery state — per (subscription × effective sacred date).
-- Tracks the state machine for the Queue fanout path.
-- status: 'queued' | 'sending' | 'delivered' | 'abandoned'
-- Scan consumer inserts with 3 explicit params (subscription_id, sacred_date, lease_token);
-- all other columns default so each INSERT batch stays at 33 rows × 3 = 99 params.
-- Notification payload is not stored here — it travels through the Queue message body.
CREATE TABLE IF NOT EXISTS delivery_events (
  subscription_id       TEXT    NOT NULL,
  sacred_date           TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'queued',   -- queued|sending|delivered|abandoned
  lease_token           TEXT,                               -- UUID from scan; verified at claim time; NULL after delivery/abandonment
  leased_at             INTEGER NOT NULL DEFAULT 0,
  send_started_at       INTEGER NOT NULL DEFAULT 0,          -- set when claim succeeds
  lease_generation      INTEGER NOT NULL DEFAULT 1,
  send_attempt_count    INTEGER NOT NULL DEFAULT 0,
  claimed_queue_attempt INTEGER,
  PRIMARY KEY (subscription_id, sacred_date)
);

-- Scan lock — single row prevents overlapping scan chains.
-- lock_expires_at is renewed by each scan continuation message.
-- Cleared on final (empty-results) page; auto-expires after TTL if Worker crashes.
CREATE TABLE IF NOT EXISTS scan_state (
  lock_id         TEXT    PRIMARY KEY,
  locked_at       INTEGER NOT NULL,
  lock_expires_at INTEGER NOT NULL,
  run_id          TEXT    NOT NULL
);
