// Scheduled handler — runs every 30 minutes via the cron trigger.
// For each subscription whose next_push_at_utc has passed:
//   1. Compute the effective local sacred date.
//   2. Check the sent_log idempotency fence (skip if already sent today).
//   3. Compute the notification (FEAST > MONTH_START > LUNAR > SUNDAY).
//   4. Reserve the idempotency slot BEFORE sending.
//   5. Send push:
//        ok        → retain reservation, advance schedule
//        gone      → delete subscription, return (no schedule advance)
//        transient → DELETE reservation (allow retry on next cron), return
//   6. If no notification warranted, advance schedule without reserving.

import { computeNotification } from './notify.js';
import { sendPushNotification }  from './push.js';
import { sacredDateKey, nextPushAtUtc } from './util.js';

// Re-use the calendar namespace set up by notify.js's side-effect imports.
const C = globalThis.SacredCalendar;

export async function handleScheduled(env) {
  const now   = new Date();
  const nowMs = now.getTime();

  const vapid = {
    subject:    env.VAPID_SUBJECT,
    publicKey:  env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };

  // Fetch all subscriptions due for a push (batch up to 500 at a time).
  const { results } = await env.DB.prepare(
    'SELECT id, endpoint, p256dh, auth, timezone, silent_supported, next_push_at_utc ' +
    'FROM subscriptions WHERE next_push_at_utc <= ? LIMIT 500'
  ).bind(nowMs).all();

  for (const sub of results) {
    await processSub(sub, now, vapid, env.DB).catch(err => {
      // Log and continue; one bad subscription must not abort the batch.
      console.error('scheduler: sub', sub.id, err.message);
    });
  }
}

async function processSub(sub, now, vapid, db) {
  const timezone   = sub.timezone || 'UTC';
  const pushHour   = sub.silent_supported ? 5 : 9;

  const eld        = C.effectiveLocalDate(now, timezone);
  const dateKey    = sacredDateKey(eld);
  const nextPush   = nextPushAtUtc(eld, timezone, pushHour);

  // Idempotency fence: skip if we already sent for this sacred date.
  const logged = await db.prepare(
    'SELECT 1 FROM sent_log WHERE subscription_id = ? AND sacred_date = ?'
  ).bind(sub.id, dateKey).first();

  if (logged) {
    // Already sent today — just advance the schedule if it's stale.
    await db.prepare(
      'UPDATE subscriptions SET next_push_at_utc = ? WHERE id = ?'
    ).bind(nextPush.getTime(), sub.id).run();
    return;
  }

  const notification = computeNotification(now, timezone);

  if (notification) {
    notification.silent = !!sub.silent_supported;

    // Reserve the idempotency slot BEFORE sending so a duplicate cron run
    // cannot race into a second send while the first is in flight.
    await db.prepare(
      'INSERT OR IGNORE INTO sent_log (subscription_id, sacred_date) VALUES (?, ?)'
    ).bind(sub.id, dateKey).run();

    const result = await sendPushNotification(sub, notification, vapid);

    if (result.gone) {
      // Push service says subscription is no longer valid — remove it.
      // Reservation remains in sent_log; irrelevant once subscription is deleted.
      await db.prepare(
        'DELETE FROM subscriptions WHERE id = ?'
      ).bind(sub.id).run();
      return;
    }

    if (result.transient) {
      // Retryable failure (429/5xx/network). Roll back the idempotency reservation
      // so the next cron run can attempt this push again.
      // Do NOT advance next_push_at_utc — subscription stays due so cron picks it up.
      await db.prepare(
        'DELETE FROM sent_log WHERE subscription_id = ? AND sacred_date = ?'
      ).bind(sub.id, dateKey).run();
      return;
    }

    // result.ok — reservation retained, fall through to advance the schedule.
  }

  // Advance the schedule so the cron does not re-visit this subscription
  // every 30 minutes once today's push window has been handled.
  await db.prepare(
    'UPDATE subscriptions SET next_push_at_utc = ? WHERE id = ?'
  ).bind(nextPush.getTime(), sub.id).run();
}
