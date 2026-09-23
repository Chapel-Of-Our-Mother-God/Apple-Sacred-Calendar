// Cron producer — runs every 5 minutes via the Worker cron trigger.
// Acquires the D1 scan lock and enqueues one root {type:"scan"} message
// that fans out into scan → deliver chains via Cloudflare Queues.
//
// The lock prevents overlapping root scan chains if the Worker is invoked
// while a previous chain is still running.  TTL ensures auto-recovery from
// crashes: a new cron invocation will take over after SCAN_LOCK_TTL_MS.
//
// D1 queries: 2 (SELECT lock + UPSERT lock) + 1 Queue enqueue = 2 D1 queries.

import { sacredDateKey, nextPushAtUtc } from './util.js';
import { validateVapid } from './vapid.js';

const SCAN_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function handleScheduled(env) {
  // Fail fast: validate VAPID keys before any D1 or Queue activity.
  if (!validateVapid(env)) return;

  const nowMs  = Date.now();

  // Skip if no subscriptions are currently due — avoids unnecessary Queue ops.
  const due = await env.DB.prepare(
    'SELECT 1 FROM subscriptions WHERE next_push_at_utc <= ? LIMIT 1'
  ).bind(nowMs).first();
  if (!due) return;

  const runId  = crypto.randomUUID();
  const expires = nowMs + SCAN_LOCK_TTL_MS;

  // Check for an active lock held by another run.
  const existing = await env.DB.prepare(
    'SELECT lock_expires_at FROM scan_state WHERE lock_id=?'
  ).bind('root').first();

  if (existing && existing.lock_expires_at > nowMs) {
    // Active lock held by a prior scan chain — skip this cron tick.
    return;
  }

  // No lock or expired lock — claim / renew it with this run's ID.
  await env.DB.prepare(
    'INSERT INTO scan_state (lock_id, locked_at, lock_expires_at, run_id) VALUES (?,?,?,?) ' +
    'ON CONFLICT(lock_id) DO UPDATE SET ' +
    'locked_at=excluded.locked_at, lock_expires_at=excluded.lock_expires_at, run_id=excluded.run_id'
  ).bind('root', nowMs, expires, runId).run();

  // Enqueue root scan message — cursor starts at (0, '') to scan from the beginning.
  await env.PUSH_QUEUE.send({
    type:        'scan',
    run_id:      runId,
    scan_now:    nowMs,
    cursor_time: 0,
    cursor_id:   ''
  });
}

// ── Legacy sequential scheduler (inactive — kept for rollback reference) ─────
// Never called in the Queue architecture.  Retained so a one-line import swap
// in index.js can revert to the old behaviour if Queues are unavailable.
async function handleScheduledLegacy(env) {
  const now   = new Date();
  const nowMs = now.getTime();

  const vapid = {
    subject:    env.VAPID_SUBJECT,
    publicKey:  env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };

  const { results } = await env.DB.prepare(
    'SELECT id, endpoint, p256dh, auth, timezone, silent_supported, next_push_at_utc ' +
    'FROM subscriptions WHERE next_push_at_utc <= ? LIMIT 500'
  ).bind(nowMs).all();

  for (const sub of results) {
    await processSubLegacy(sub, now, vapid, env.DB).catch(err => {
      console.error('scheduler: sub', sub.id, err.message);
    });
  }
}

async function processSubLegacy(sub, now, vapid, db) {
  const timezone   = sub.timezone || 'UTC';
  const pushHour   = sub.silent_supported ? 5 : 9;

  const eld        = C.effectiveLocalDate(now, timezone);
  const dateKey    = sacredDateKey(eld);
  const nextPush   = nextPushAtUtc(eld, timezone, pushHour);

  const logged = await db.prepare(
    'SELECT 1 FROM sent_log WHERE subscription_id = ? AND sacred_date = ?'
  ).bind(sub.id, dateKey).first();

  if (logged) {
    await db.prepare(
      'UPDATE subscriptions SET next_push_at_utc = ? WHERE id = ?'
    ).bind(nextPush.getTime(), sub.id).run();
    return;
  }

  const notification = computeNotification(now, timezone);

  if (notification) {
    notification.silent = !!sub.silent_supported;

    await db.prepare(
      'INSERT OR IGNORE INTO sent_log (subscription_id, sacred_date) VALUES (?, ?)'
    ).bind(sub.id, dateKey).run();

    const result = await sendPushNotification(sub, notification, vapid);

    if (result.gone) {
      await db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(sub.id).run();
      return;
    }

    if (result.transient) {
      await db.prepare(
        'DELETE FROM sent_log WHERE subscription_id = ? AND sacred_date = ?'
      ).bind(sub.id, dateKey).run();
      return;
    }
  }

  await db.prepare(
    'UPDATE subscriptions SET next_push_at_utc = ? WHERE id = ?'
  ).bind(nextPush.getTime(), sub.id).run();
}
