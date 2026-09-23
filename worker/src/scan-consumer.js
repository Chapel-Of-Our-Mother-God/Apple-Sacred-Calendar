// Queue scan consumer.
// Handles {type:"scan"} messages: pages through due subscriptions, computes
// per-subscription notifications, leases notifiable rows into delivery_events,
// advances no-notification subscriptions, and fans out deliver messages.
//
// D1 query budget per 500-sub page (well under 50/invocation):
//   1 lock UPDATE + 1 cursor SELECT + ≤16 lease INSERTs + ≤1 advance UPDATE = ≤19 (non-final)
//   Non-final pages skip the scan-lock DELETE; final non-empty page adds it → ≤20.
// Lease INSERT: 33 rows × 3 params (subscription_id, sacred_date, lease_token) = 99 params.
// Advance UPDATE: 33 rows × 3 params = 99 params per batch (CASE statement).
// Cursor: explicit parentheses guard prevents row-skipping at boundary.

import { computeNotification } from './notify.js';
import { sacredDateKey, nextPushAtUtc } from './util.js';
import { validateVapid } from './vapid.js';

const C = globalThis.SacredCalendar;

const PAGE_SIZE          = 500;
const LEASE_CHUNK        = 33;  // 33 rows × 3 params = 99 ≤ 100 per INSERT batch
const ADVANCE_CHUNK      = 33;  // 33 rows × 3 params = 99 ≤ 100 per CASE UPDATE
const DELIVER_N          = 20;  // subscription IDs per deliver Queue message
const SCAN_LOCK_TTL_MS   = 10 * 60 * 1000; // 10 minutes

export async function handleScan(body, env) {
  if (!validateVapid(env)) return;

  const { run_id, scan_now, cursor_time, cursor_id } = body;

  // Renew scan lock TTL so it doesn't expire mid-chain.
  const newExpiry = Date.now() + SCAN_LOCK_TTL_MS;
  await env.DB.prepare(
    'UPDATE scan_state SET lock_expires_at=? WHERE lock_id=? AND run_id=?'
  ).bind(newExpiry, 'root', run_id).run();

  // Cursor-paginated SELECT of subscriptions due at or before scan_now.
  // Explicit parentheses on the cursor condition prevent row-skipping at
  // next_push_at_utc boundaries when two rows share the same timestamp.
  const { results } = await env.DB.prepare(
    'SELECT id, endpoint, p256dh, auth, timezone, silent_supported, next_push_at_utc ' +
    'FROM subscriptions ' +
    'WHERE (next_push_at_utc > ? OR (next_push_at_utc = ? AND id > ?)) ' +
    'AND next_push_at_utc <= ? ' +
    'ORDER BY next_push_at_utc, id ' +
    'LIMIT ?'
  ).bind(cursor_time, cursor_time, cursor_id, scan_now, PAGE_SIZE).all();

  // Final page — release the scan lock.
  if (results.length === 0) {
    await env.DB.prepare(
      'DELETE FROM scan_state WHERE lock_id=? AND run_id=?'
    ).bind('root', run_id).run();
    return;
  }

  const notifiable = [];
  const noNotify   = [];
  const nowDate    = new Date(scan_now);

  for (const sub of results) {
    const tz          = sub.timezone || 'UTC';
    const eld         = C.effectiveLocalDate(nowDate, tz);
    const sacred_date = sacredDateKey(eld);
    const notification = computeNotification(nowDate, tz);

    if (notification) {
      notification.silent = !!sub.silent_supported;
      notification.tag    = `${sacred_date}-${notification.type}`;
      const lease_token   = crypto.randomUUID();
      notifiable.push({ sub, sacred_date, notification, lease_token });
    } else {
      const pushHour = sub.silent_supported ? 5 : 9;
      const nextPush = nextPushAtUtc(eld, tz, pushHour);
      noNotify.push({ sub, nextPush });
    }
  }

  // Build D1 statements for this page.
  const stmts = [];

  // Lease INSERT — 33 rows × 3 params (sub_id, sacred_date, lease_token) = 99 params per batch.
  // INSERT OR IGNORE: skip if this (subscription_id, sacred_date) already has a row.
  for (let i = 0; i < notifiable.length; i += LEASE_CHUNK) {
    const chunk        = notifiable.slice(i, i + LEASE_CHUNK);
    const placeholders = chunk.map(() => '(?,?,?)').join(',');
    const params       = [];
    for (const { sub, sacred_date, lease_token } of chunk) {
      params.push(sub.id, sacred_date, lease_token);
    }
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO delivery_events (subscription_id, sacred_date, lease_token) VALUES ${placeholders}`
      ).bind(...params)
    );
  }

  // No-notification advance — CASE UPDATE, 33 rows × 3 params = 99 params per batch.
  for (let i = 0; i < noNotify.length; i += ADVANCE_CHUNK) {
    const chunk    = noNotify.slice(i, i + ADVANCE_CHUNK);
    const caseWhen = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const inList   = chunk.map(() => '?').join(',');
    const params   = [
      ...chunk.flatMap(({ sub, nextPush }) => [sub.id, nextPush.getTime()]),
      ...chunk.map(({ sub }) => sub.id)
    ];
    stmts.push(
      env.DB.prepare(
        `UPDATE subscriptions SET next_push_at_utc = CASE id ${caseWhen} END WHERE id IN (${inList})`
      ).bind(...params)
    );
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  // Fan out deliver messages (DELIVER_N IDs per message).
  const queueMessages = [];

  for (let i = 0; i < notifiable.length; i += DELIVER_N) {
    const chunk = notifiable.slice(i, i + DELIVER_N);
    queueMessages.push({
      body: {
        type:       'deliver',
        run_id,
        scan_now,
        deliveries: chunk.map(({ sub, sacred_date, notification, lease_token }) => ({
          id:          sub.id,
          sacred_date,
          lease_token,
          endpoint:    sub.endpoint,
          p256dh:      sub.p256dh,
          auth:        sub.auth,
          timezone:    sub.timezone || 'UTC',
          silent:      !!sub.silent_supported,
          notification
        }))
      }
    });
  }

  // Continuation scan message (only if full page — partial page means no more rows).
  if (results.length === PAGE_SIZE) {
    const last = results[results.length - 1];
    queueMessages.push({
      body: {
        type:        'scan',
        run_id,
        scan_now,
        cursor_time: last.next_push_at_utc,
        cursor_id:   last.id
      }
    });
  } else {
    // Final page with data — release scan lock after this batch.
    await env.DB.prepare(
      'DELETE FROM scan_state WHERE lock_id=? AND run_id=?'
    ).bind('root', run_id).run();
  }

  if (queueMessages.length > 0) {
    await env.PUSH_QUEUE.sendBatch(queueMessages);
  }
}
