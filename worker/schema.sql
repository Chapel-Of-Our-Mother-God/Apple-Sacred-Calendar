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
