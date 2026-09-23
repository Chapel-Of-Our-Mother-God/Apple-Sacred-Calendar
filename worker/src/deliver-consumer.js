// Queue deliver consumer.
// Handles {type:"deliver"} messages: claims leases atomically, pushes
// notifications in groups of 5 concurrent, and commits terminal state
// via DB.batch using CASE statements (≤60 params each, well under 100 limit).
//
// D1 query budget per invocation (N=20):
//   20 claim UPDATEs + terminal stmts: success=22, 410-gone=21, abandon=22, mixed=26 (≤50).
//
// State machine per (subscription_id, sacred_date):
//   queued  → sending  (pre-send claim; verifies lease_token + attempt guard)
//   sending → delivered (ok push)
//   sending → queued    (transient failure; Queue will retry with higher msg.attempts)
//   sending → abandoned (transient on final Queue attempt, or send_attempt_count >= 3)
//   Any state: subscription deleted on gone (410/404)

import { sendPushNotification } from './push.js';
import { nextPushAtUtc, sacredDateKey } from './util.js';
import { validateVapid } from './vapid.js';

const C = globalThis.SacredCalendar;

// Max Queue attempts (max_retries=2 → attempts 1, 2, 3).
const MAX_QUEUE_ATTEMPTS = 3;
const PUSH_CONCURRENCY   = 5;

export async function handleDeliver(body, env, msgAttempts) {
  if (!validateVapid(env)) return;

  const { deliveries, scan_now } = body;
  if (!deliveries || deliveries.length === 0) return;

  const nowMs = Date.now();

  const vapid = {
    subject:    env.VAPID_SUBJECT,
    publicKey:  env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };

  // ── Pre-send claim ─────────────────────────────────────────────────────────
  // Atomically claims each lease: status 'queued' → 'sending', increments
  // send_attempt_count, records which Queue attempt owns this slot, stamps times.
  // Guards:
  //   lease_token=?           — stale tokens (from a superseded scan) cannot claim
  //   claimed_queue_attempt < msgAttempts — rejects duplicate deliveries of the same attempt
  //   send_attempt_count < 3  — caps actual push attempts per sacred date
  const claimStmts = deliveries.map(d =>
    env.DB.prepare(
      'UPDATE delivery_events ' +
      'SET status=\'sending\', claimed_queue_attempt=?, send_attempt_count=send_attempt_count+1, ' +
      'send_started_at=?, leased_at=? ' +
      'WHERE subscription_id=? AND sacred_date=? AND lease_token=? AND status=\'queued\' ' +
      'AND (claimed_queue_attempt IS NULL OR claimed_queue_attempt<?) ' +
      'AND send_attempt_count<3'
    ).bind(msgAttempts, nowMs, nowMs, d.id, d.sacred_date, d.lease_token, msgAttempts)
  );

  const claimResults = await env.DB.batch(claimStmts);

  // Subscriptions that were successfully claimed (changes > 0).
  const claimed = deliveries.filter((_, i) => claimResults[i].meta.changes > 0);

  if (claimed.length === 0) return; // all duplicates or already terminal

  // ── Push notifications ─────────────────────────────────────────────────────
  // Groups of PUSH_CONCURRENCY concurrent fetches.
  const pushOutcomes = new Map(); // id → {ok?} | {gone?} | {transient?}

  for (let i = 0; i < claimed.length; i += PUSH_CONCURRENCY) {
    const group = claimed.slice(i, i + PUSH_CONCURRENCY);
    const results = await Promise.all(group.map(async d => {
      const result = await sendPushNotification(
        { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
        d.notification,
        vapid
      ).catch(err => {
        console.error('deliver: push error sub_len=' + d.id.length, err.message);
        return { transient: true };
      });
      return { d, result };
    }));
    for (const { d, result } of results) pushOutcomes.set(d.id, result);
  }

  // ── Categorise results ─────────────────────────────────────────────────────
  const succeeded = [];
  const transient  = [];
  const abandoned  = [];
  const gone       = [];

  for (const d of claimed) {
    const r = pushOutcomes.get(d.id) ?? { transient: true };
    if (r.ok) {
      succeeded.push(d);
    } else if (r.gone) {
      gone.push(d);
    } else {
      // Transient failure: abandon on final Queue attempt, else allow retry.
      if (msgAttempts >= MAX_QUEUE_ATTEMPTS) {
        abandoned.push(d);
      } else {
        transient.push(d);
      }
    }
  }

  // ── Terminal state via DB.batch ────────────────────────────────────────────
  // CASE-based bulk updates keep query count ≤ 6 regardless of N.
  // Each CASE UPDATE: N + 2N = 3N params (N=20 → 60 params, ≤ 100 limit).
  const nowDate = new Date(scan_now);
  const termStmts = [];

  if (succeeded.length > 0) {
    // delivery_events → 'delivered'
    termStmts.push(
      env.DB.prepare(buildCaseDeliveryUpdate('delivered', succeeded))
        .bind(...buildCaseDeliveryParams(succeeded))
    );
    // subscriptions → advance next_push_at_utc
    const advancePairs = succeeded.map(d => ({
      id:              d.id,
      next_push_at_utc: computeNextPush(d, nowDate)
    }));
    termStmts.push(
      env.DB.prepare(buildCaseAdvanceUpdate(advancePairs))
        .bind(...buildCaseAdvanceParams(advancePairs))
    );
  }

  if (abandoned.length > 0) {
    // delivery_events → 'abandoned'
    termStmts.push(
      env.DB.prepare(buildCaseDeliveryUpdate('abandoned', abandoned))
        .bind(...buildCaseDeliveryParams(abandoned))
    );
    // subscriptions → advance next_push_at_utc
    const advancePairs = abandoned.map(d => ({
      id:              d.id,
      next_push_at_utc: computeNextPush(d, nowDate)
    }));
    termStmts.push(
      env.DB.prepare(buildCaseAdvanceUpdate(advancePairs))
        .bind(...buildCaseAdvanceParams(advancePairs))
    );
  }

  if (transient.length > 0) {
    // Roll back to 'queued' so the next Queue retry can claim.
    termStmts.push(
      env.DB.prepare(buildCaseDeliveryUpdate('queued', transient))
        .bind(...buildCaseDeliveryParams(transient))
    );
  }

  if (gone.length > 0) {
    const inList = gone.map(() => '?').join(',');
    termStmts.push(
      env.DB.prepare(`DELETE FROM subscriptions WHERE id IN (${inList})`)
        .bind(...gone.map(d => d.id))
    );
  }

  if (termStmts.length > 0) {
    await env.DB.batch(termStmts);
  }
}

// ── SQL helpers ───────────────────────────────────────────────────────────────

// UPDATE delivery_events SET status='<s>' WHERE subscription_id IN (...) AND sacred_date = CASE ...
function buildCaseDeliveryUpdate(status, rows) {
  const inList   = rows.map(() => '?').join(',');
  const caseWhen = rows.map(() => 'WHEN ? THEN ?').join(' ');
  return `UPDATE delivery_events SET status='${status}' ` +
         `WHERE subscription_id IN (${inList}) ` +
         `AND sacred_date = CASE subscription_id ${caseWhen} END`;
}

function buildCaseDeliveryParams(rows) {
  return [
    ...rows.map(r => r.id),
    ...rows.flatMap(r => [r.id, r.sacred_date])
  ];
}

// UPDATE subscriptions SET next_push_at_utc = CASE id WHEN ? THEN ? ... WHERE id IN (...)
function buildCaseAdvanceUpdate(pairs) {
  const caseWhen = pairs.map(() => 'WHEN ? THEN ?').join(' ');
  const inList   = pairs.map(() => '?').join(',');
  return `UPDATE subscriptions SET next_push_at_utc = CASE id ${caseWhen} END WHERE id IN (${inList})`;
}

function buildCaseAdvanceParams(pairs) {
  return [
    ...pairs.flatMap(p => [p.id, p.next_push_at_utc]),
    ...pairs.map(p => p.id)
  ];
}

function computeNextPush(d, nowDate) {
  const tz       = d.timezone || 'UTC';
  const pushHour = d.silent ? 5 : 9;
  const eld      = C.effectiveLocalDate(nowDate, tz);
  return nextPushAtUtc(eld, tz, pushHour).getTime();
}
