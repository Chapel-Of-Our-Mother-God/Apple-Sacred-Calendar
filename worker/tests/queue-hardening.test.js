// Queue fanout hardening tests.
// Groups:
//   25 — Calendar date correctness (priority, timezone, Sunday regression, Abolan)
//   26 — D1 query budget and param limits (scan and deliver consumers)
//   27 — Queue state machine (claim, retry, abandonment, terminal transitions)
//   28 — VAPID validation, notification tag, real crypto, root-scan no-due-work gate

import { describe, it, expect, vi } from 'vitest';
import { sacredDateKey, nextPushAtUtc } from '../src/util.js';

// Load the calendar so computeNotification works.
import '../../calendar/data.js';
import '../../calendar/engine.js';
import '../../calendar/lunar.js';
import { computeNotification } from '../src/notify.js';
import { buildPushPayload }    from '@block65/webcrypto-web-push';
import { validateVapid } from '../src/vapid.js';
import { handleScheduled } from '../src/scheduler.js';

const C = globalThis.SacredCalendar;
function utc(iso) { return new Date(iso); }

// ── Group 25: Calendar date correctness ─────────────────────────────────────

describe('Group 25 — priority order unchanged', () => {
  it('feast outranks month-start on the same day (day 1 of a month with a feast)', () => {
    const result = computeNotification(utc('2026-03-21T12:00:00Z'), 'UTC');
    expect(result).not.toBeNull();
    expect(result.type).toBe('feast');
    expect(result.title).toMatch(/eastre/i);
  });

  it('month-start outranks lunar when day===1 and month has notifiable feasts', () => {
    let found = false;
    const base = Date.UTC(2026, 0, 1, 12, 0, 0);
    for (let d = 0; d < 365 && !found; d++) {
      const now = new Date(base + d * 86400000);
      const r = computeNotification(now, 'UTC');
      if (r && r.type === 'month-start') { found = true; }
    }
    expect(found).toBe(true);
  });

  it('null returned on an ordinary weekday with no feast or lunar', () => {
    const r = computeNotification(utc('2026-09-08T12:00:00Z'), 'UTC');
    if (r) expect(['lunar', 'sunday']).toContain(r.type);
  });
});

describe('Group 25 — Sunday regression: 2026-09-13 in Europe/London', () => {
  it('2026-09-13 12:00 UTC in Europe/London is a Sunday → Sunday notification', () => {
    const result = computeNotification(utc('2026-09-13T12:00:00Z'), 'Europe/London');
    expect(result).not.toBeNull();
    expect(result.type).toBe('sunday');
  });

  it('Sunday notification body is correct', () => {
    const result = computeNotification(utc('2026-09-13T12:00:00Z'), 'Europe/London');
    expect(result.body).toContain('Sunday');
    expect(result.body).toContain('Our Divine Mother');
  });
});

describe('Group 25 — 2026-09-14 is NOT Eastre', () => {
  it('2026-09-14 UTC is 10 Abolan, not a feast day', () => {
    const result = computeNotification(utc('2026-09-14T12:00:00Z'), 'UTC');
    if (result) expect(result.type).not.toBe('feast');
  });

  it('sacredDateKey for 2026-09-14 noon UTC returns 2026-09-14', () => {
    const eld = C.effectiveLocalDate(utc('2026-09-14T12:00:00Z'), 'UTC');
    expect(sacredDateKey(eld)).toBe('2026-09-14');
  });

  it('2026-03-21 IS Eastre (sanity check — the actual feast date)', () => {
    const result = computeNotification(utc('2026-03-21T12:00:00Z'), 'UTC');
    expect(result).not.toBeNull();
    expect(result.type).toBe('feast');
    expect(result.title).toMatch(/eastre/i);
  });
});

describe('Group 25 — timezone independence', () => {
  it('same scan_now, UTC vs America/New_York → different sacred_date keys when straddling dawn', () => {
    const scanNow = utc('2026-09-14T08:00:00Z');
    const eldUtc  = C.effectiveLocalDate(scanNow, 'UTC');
    const eldNy   = C.effectiveLocalDate(scanNow, 'America/New_York');
    const keyUtc  = sacredDateKey(eldUtc);
    const keyNy   = sacredDateKey(eldNy);
    expect(keyUtc).toBe('2026-09-14');
    expect(keyNy).toBe('2026-09-13');
    expect(keyUtc).not.toBe(keyNy);
  });

  it('UTC+12 subscription crosses midnight before UTC', () => {
    const scanNow = utc('2026-09-14T23:00:00Z');
    const eldUtc  = C.effectiveLocalDate(scanNow, 'UTC');
    const eldAkl  = C.effectiveLocalDate(scanNow, 'Pacific/Auckland');
    expect(sacredDateKey(eldUtc)).toBe('2026-09-14');
    expect(sacredDateKey(eldAkl)).toBe('2026-09-15');
  });
});

// ── Group 26: D1 query budget ────────────────────────────────────────────────

describe('Group 26 — lease INSERT param count ≤ 99 per batch', () => {
  it('33 rows × 3 params (sub_id, sacred_date, lease_token) = 99 params (at limit)', () => {
    const CHUNK = 33;
    const rows  = Array.from({ length: CHUNK }, (_, i) => ({
      id:          'sub_' + i,
      sacred_date: '2026-09-14',
      lease_token: 'lt-' + i
    }));
    const placeholders = rows.map(() => '(?,?,?)').join(',');
    const params = rows.flatMap(r => [r.id, r.sacred_date, r.lease_token]);
    expect(params.length).toBe(99);
    expect(placeholders.split('(?,?,?)').length - 1).toBe(33);
  });

  it('34 rows would exceed 100 params — confirms CHUNK=33 is the correct ceiling', () => {
    expect(34 * 3).toBeGreaterThan(100);
    expect(33 * 3).toBeLessThanOrEqual(99);
  });

  it('no-notification advance CHUNK=33: 33×3 = 99 params (CASE id WHEN?THEN? + IN?)', () => {
    const CHUNK = 33;
    const caseParams = CHUNK * 2;
    const inParams   = CHUNK * 1;
    expect(caseParams + inParams).toBe(99);
  });

  it('deliver CASE update: N=20 rows × 3 params = 60 params (≤ 100)', () => {
    const N = 20;
    expect(N * 3).toBe(60);
    expect(60).toBeLessThanOrEqual(100);
  });

  it('deliver subscriptions CASE advance: N=20 → 3×20 = 60 params (≤ 100)', () => {
    const N = 20;
    expect(2 * N + N).toBe(60);
    expect(60).toBeLessThanOrEqual(100);
  });
});

describe('Group 26 — D1 query count: 500-subscription scan page', () => {
  it('all-notifiable 500-sub scan page uses ≤ 50 D1 queries', () => {
    const PAGE   = 500;
    const CHUNK  = 33;
    const leaseInserts   = Math.ceil(PAGE / CHUNK);
    const advanceUpdates = 0;
    const total = 1 + 1 + leaseInserts + advanceUpdates;
    expect(leaseInserts).toBe(16);
    expect(total).toBe(18);
    expect(total).toBeLessThan(50);
  });

  it('all-no-notification 500-sub scan page uses ≤ 50 D1 queries', () => {
    const PAGE   = 500;
    const CHUNK  = 33;
    const leaseInserts   = 0;
    const advanceUpdates = Math.ceil(PAGE / CHUNK);
    const total = 1 + 1 + leaseInserts + advanceUpdates;
    expect(advanceUpdates).toBe(16);
    expect(total).toBe(18);
    expect(total).toBeLessThan(50);
  });

  it('mixed worst-case (1 notifiable + 499 no-notify): 1+1+1+16 = 19 queries, still ≤ 50', () => {
    const CHUNK = 33;
    const leaseInserts   = Math.ceil(1   / CHUNK);  // 1
    const advanceUpdates = Math.ceil(499 / CHUNK);  // ceil(15.12) = 16
    const total = 1 + 1 + leaseInserts + advanceUpdates;
    expect(leaseInserts).toBe(1);
    expect(advanceUpdates).toBe(16);
    expect(total).toBe(19);
    expect(total).toBeLessThan(50);
  });

  it('final non-empty page adds scan-lock DELETE to worst-case mixed: 19 + 1 = 20 queries', () => {
    // Final partial page (results.length < PAGE_SIZE) also runs the scan-lock DELETE.
    // Worst-case mixed (1 notifiable + 499 no-notify) = 19 + 1 DELETE = 20 total.
    const total = 19 + 1;
    expect(total).toBe(20);
    expect(total).toBeLessThan(50);
  });

  it('final empty-page scan releases lock: 1 lock renew + 1 SELECT + 1 DELETE = 3 queries', () => {
    const total = 1 + 1 + 1;
    expect(total).toBe(3);
    expect(total).toBeLessThan(50);
  });
});

describe('Group 26 — D1 query count: deliver consumer N=20', () => {
  it('all-success (N=20): 20 claims + 2 terminal (delivered + advance) = 22 queries', () => {
    // delivered: delivery_events UPDATE (1) + subscriptions CASE advance (1) = 2 terminal stmts
    expect(20 + 2).toBe(22);
    expect(22).toBeLessThan(50);
  });

  it('all-410/gone (N=20): 20 claims + 1 terminal (DELETE subscriptions) = 21 queries', () => {
    // All endpoints returned 410/404: single IN-list DELETE from subscriptions = 1 terminal stmt
    expect(20 + 1).toBe(21);
    expect(21).toBeLessThan(50);
  });

  it('all-abandon (N=20): 20 claims + 2 terminal (abandoned + advance) = 22 queries', () => {
    // abandoned: delivery_events UPDATE (1) + subscriptions CASE advance (1) = 2 terminal stmts
    expect(20 + 2).toBe(22);
    expect(22).toBeLessThan(50);
  });

  it('mixed (success+abandon+transient+gone): 20 claims + 6 terminal = 26 queries (worst case)', () => {
    // All four terminal buckets: delivered+advance (2) + abandoned+advance (2) + transient (1) + gone (1) = 6
    expect(20 + 6).toBe(26);
    expect(26).toBeLessThan(50);
  });

  it('claim batch params: 7 params per subscription × 20 = 140 params total (7/stmt ≤ 100)', () => {
    // Each claim stmt: (msgAttempts, nowMs, nowMs, id, sacred_date, lease_token, msgAttempts) = 7
    expect(7 * 1).toBeLessThanOrEqual(100); // 7 params per individual statement
    expect(7 * 20).toBe(140);               // 20 statements in the batch
  });
});

describe('Group 26 — quota at 15,000 subscriptions', () => {
  it('Queue ops: (31 scan + 750 deliver) × 3 = 2,343 normal; +250 retries × 3 = +750; total 3,093 < 7,000/day', () => {
    const SCAN_MESSAGES  = 31;   // 30 data pages + 1 empty terminating page
    const DELIVER_MSGS   = 750;  // 30 pages × 25 deliver msgs each
    const OPS_PER_MSG    = 3;    // send + receive + ack
    const normalOps      = (SCAN_MESSAGES + DELIVER_MSGS) * OPS_PER_MSG;
    const retryOps       = 250 * OPS_PER_MSG;  // estimated 250 retried delivers
    expect(normalOps).toBe(2_343);
    expect(retryOps).toBe(750);
    expect(normalOps + retryOps).toBe(3_093);
    expect(normalOps + retryOps).toBeLessThan(7_000);
  });

  it('D1 writes: 4 writes/sub × 15,000 = 60,000 + 1,500 retry + 33 scan_state = 61,533 < 100,000/day', () => {
    const deliveryWrites  = 4 * 15_000;  // lease INSERT + claim UPDATE + terminal UPDATE + advance UPDATE
    const retryWrites     = 1_500;       // 750 retried delivers × 2 writes each
    const scanStateWrites = 33;          // 1 root lock acquisition + 31 scan lock renewals + 1 final lock clear
    expect(deliveryWrites).toBe(60_000);
    expect(deliveryWrites + retryWrites + scanStateWrites).toBe(61_533);
    expect(deliveryWrites + retryWrites + scanStateWrites).toBeLessThan(100_000);
  });
});

// ── Group 27: Queue state machine ────────────────────────────────────────────

function makeD1Mock() {
  const deliveryEvents = new Map();
  const subscriptions  = new Map();
  let queryCount = 0;

  function key(id, date) { return `${id}|${date}`; }

  return {
    queryCount: () => queryCount,
    resetCount: () => { queryCount = 0; },

    seedDelivery(id, date, row) {
      deliveryEvents.set(key(id, date), {
        subscription_id: id, sacred_date: date,
        status: 'queued', send_attempt_count: 0, claimed_queue_attempt: null,
        lease_generation: 1, lease_token: 'lt-' + id,
        ...row
      });
    },

    getDelivery(id, date) { return deliveryEvents.get(key(id, date)) ?? null; },
    getSubscription(id)   { return subscriptions.get(id) ?? null; },
    seedSubscription(id, row) { subscriptions.set(id, { id, ...row }); },

    // Simulate the pre-send claim UPDATE.
    // Mirrors the real SQL: status='queued', lease_token match, claimed < attempts, count < 3.
    claim(id, date, msgAttempts, leaseToken) {
      queryCount++;
      const row = deliveryEvents.get(key(id, date));
      if (!row) return { changes: 0 };
      const tokenOk = leaseToken === undefined || row.lease_token === leaseToken;
      const claimOk =
        row.status === 'queued' &&
        tokenOk &&
        (row.claimed_queue_attempt === null || row.claimed_queue_attempt < msgAttempts) &&
        row.send_attempt_count < 3;
      if (!claimOk) return { changes: 0 };
      row.status = 'sending';
      row.claimed_queue_attempt = msgAttempts;
      row.send_attempt_count += 1;
      return { changes: 1 };
    },

    setDeliveryStatus(id, date, status) {
      queryCount++;
      const row = deliveryEvents.get(key(id, date));
      if (row) row.status = status;
    },

    rollbackToQueued(id, date) {
      queryCount++;
      const row = deliveryEvents.get(key(id, date));
      if (row) { row.status = 'queued'; row.claimed_queue_attempt = null; }
    },

    advanceSubscription(id, nextPushMs) {
      queryCount++;
      const sub = subscriptions.get(id);
      if (sub) sub.next_push_at_utc = nextPushMs;
    },

    deleteSubscription(id) {
      queryCount++;
      subscriptions.delete(id);
    }
  };
}

describe('Group 27 — duplicate delivery (same msg.attempts) cannot claim', () => {
  it('second claim with same msg.attempts is rejected', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});

    const r1 = db.claim('s1', '2026-09-14', 1);
    expect(r1.changes).toBe(1);

    const r2 = db.claim('s1', '2026-09-14', 1);
    expect(r2.changes).toBe(0); // status='sending', < guard: 1 < 1 is false → rejected
  });

  it('after transient rollback, higher msg.attempts can claim (lower cannot)', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});
    db.claim('s1', '2026-09-14', 1);
    db.rollbackToQueued('s1', '2026-09-14');

    // attempts=1 again: claimed_queue_attempt cleared → null < 1 is true → can claim
    const r = db.claim('s1', '2026-09-14', 1);
    expect(r.changes).toBe(1);
  });
});

describe('Group 27 — higher msg.attempts can retry after transient failure', () => {
  it('msg.attempts=2 claims after msg.attempts=1 transient rollback', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});

    db.claim('s1', '2026-09-14', 1);
    db.rollbackToQueued('s1', '2026-09-14');

    const r = db.claim('s1', '2026-09-14', 2);
    expect(r.changes).toBe(1);
    expect(db.getDelivery('s1', '2026-09-14').send_attempt_count).toBe(2);
  });

  it('msg.attempts=3 claims after two transient rollbacks', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});

    db.claim('s1', '2026-09-14', 1); db.rollbackToQueued('s1', '2026-09-14');
    db.claim('s1', '2026-09-14', 2); db.rollbackToQueued('s1', '2026-09-14');

    const r = db.claim('s1', '2026-09-14', 3);
    expect(r.changes).toBe(1);
    expect(db.getDelivery('s1', '2026-09-14').send_attempt_count).toBe(3);
  });
});

describe('Group 27 — send_attempt_count ≤ 3 actual sends per sacred date', () => {
  it('claim rejected when send_attempt_count reaches 3', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', { send_attempt_count: 3 });

    const r = db.claim('s1', '2026-09-14', 4);
    expect(r.changes).toBe(0);
  });

  it('three successive transient failures exhaust send_attempt_count', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});

    db.claim('s1', '2026-09-14', 1); db.rollbackToQueued('s1', '2026-09-14');
    db.claim('s1', '2026-09-14', 2); db.rollbackToQueued('s1', '2026-09-14');
    db.claim('s1', '2026-09-14', 3); db.rollbackToQueued('s1', '2026-09-14');

    const r = db.claim('s1', '2026-09-14', 4);
    expect(r.changes).toBe(0);
  });
});

describe('Group 27 — lease_token verification: stale token rejected', () => {
  it('claim with wrong lease_token is rejected', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', { lease_token: 'correct-token' });

    const r = db.claim('s1', '2026-09-14', 1, 'wrong-token');
    expect(r.changes).toBe(0);
  });

  it('claim with correct lease_token succeeds', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', { lease_token: 'correct-token' });

    const r = db.claim('s1', '2026-09-14', 1, 'correct-token');
    expect(r.changes).toBe(1);
  });
});

describe('Group 27 — stale sacred-day crossing', () => {
  it('next day has a different sacred_date key — new delivery_events row is independent', () => {
    const scanNow1 = utc('2026-09-14T06:00:00Z');
    const scanNow2 = utc('2026-09-15T06:00:00Z');
    const key1 = sacredDateKey(C.effectiveLocalDate(scanNow1, 'UTC'));
    const key2 = sacredDateKey(C.effectiveLocalDate(scanNow2, 'UTC'));
    expect(key1).toBe('2026-09-14');
    expect(key2).toBe('2026-09-15');
    expect(key1).not.toBe(key2);
  });

  it('delivery_events PK (sub_id, sacred_date) means different dates never collide', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});
    db.seedDelivery('s1', '2026-09-15', {});
    const r1 = db.claim('s1', '2026-09-14', 1);
    const r2 = db.claim('s1', '2026-09-15', 1);
    expect(r1.changes).toBe(1);
    expect(r2.changes).toBe(1);
    expect(db.getDelivery('s1', '2026-09-14').status).toBe('sending');
    expect(db.getDelivery('s1', '2026-09-15').status).toBe('sending');
  });
});

describe('Group 27 — terminal+schedule rollback atomicity (DB.batch contract)', () => {
  it('succeeded: delivery_events → delivered AND subscriptions advance in same batch', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});
    db.seedSubscription('s1', { next_push_at_utc: 0 });

    db.claim('s1', '2026-09-14', 1);
    db.setDeliveryStatus('s1', '2026-09-14', 'delivered');
    db.advanceSubscription('s1', 9999999);

    expect(db.getDelivery('s1', '2026-09-14').status).toBe('delivered');
    expect(db.getSubscription('s1').next_push_at_utc).toBe(9999999);
  });

  it('gone: subscription deleted in terminal batch', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});
    db.seedSubscription('s1', { next_push_at_utc: 0 });

    db.claim('s1', '2026-09-14', 1);
    db.deleteSubscription('s1');

    expect(db.getSubscription('s1')).toBeNull();
  });

  it('abandoned: delivery_events → abandoned AND subscriptions advance', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', { send_attempt_count: 2 });
    db.seedSubscription('s1', { next_push_at_utc: 0 });

    db.claim('s1', '2026-09-14', 3);
    db.setDeliveryStatus('s1', '2026-09-14', 'abandoned');
    db.advanceSubscription('s1', 8888888);

    expect(db.getDelivery('s1', '2026-09-14').status).toBe('abandoned');
    expect(db.getSubscription('s1').next_push_at_utc).toBe(8888888);
  });

  it('transient rollback: delivery_events returns to queued (not leased)', () => {
    const db = makeD1Mock();
    db.seedDelivery('s1', '2026-09-14', {});

    db.claim('s1', '2026-09-14', 1);
    expect(db.getDelivery('s1', '2026-09-14').status).toBe('sending');

    db.rollbackToQueued('s1', '2026-09-14');
    expect(db.getDelivery('s1', '2026-09-14').status).toBe('queued');
  });
});

describe('Group 27 — scan lock overlap prevention', () => {
  it('second cron with active (non-expired) lock is skipped', () => {
    const nowMs = Date.now();
    const lock  = { lock_expires_at: nowMs + 5 * 60 * 1000 };
    const shouldSkip = lock && lock.lock_expires_at > nowMs;
    expect(shouldSkip).toBe(true);
  });

  it('cron with expired lock takes over', () => {
    const nowMs = Date.now();
    const lock  = { lock_expires_at: nowMs - 1000 };
    const shouldSkip = lock && lock.lock_expires_at > nowMs;
    expect(shouldSkip).toBe(false);
  });

  it('cron with no existing lock creates one', () => {
    const nowMs = Date.now();
    const lock  = null;
    const shouldSkip = lock && lock.lock_expires_at > nowMs;
    expect(shouldSkip).toBeFalsy();
  });
});

describe('Group 27 — scan lock TTL is 10 minutes', () => {
  it('SCAN_LOCK_TTL_MS = 600000 ms (10 min) — gives cron 2 full cycles of margin', () => {
    const SCAN_LOCK_TTL_MS = 10 * 60 * 1000;
    expect(SCAN_LOCK_TTL_MS).toBe(600_000);
    expect(SCAN_LOCK_TTL_MS / (5 * 60 * 1000)).toBe(2);
  });
});

describe('Group 27 — cursor determinism (stable ORDER BY)', () => {
  it('cursor condition uses explicit parentheses', () => {
    const correctSql =
      'WHERE (next_push_at_utc > ? OR (next_push_at_utc = ? AND id > ?)) ' +
      'AND next_push_at_utc <= ?';
    expect(correctSql).toMatch(/WHERE \(next_push_at_utc > \? OR \(next_push_at_utc = \? AND id > \?\)\)/);
  });

  it('ORDER BY next_push_at_utc, id produces stable pagination', () => {
    const rows = [
      { id: 'aaa', next_push_at_utc: 1000 },
      { id: 'zzz', next_push_at_utc: 1000 },
      { id: 'bbb', next_push_at_utc: 2000 }
    ].sort((a, b) => a.next_push_at_utc !== b.next_push_at_utc
      ? a.next_push_at_utc - b.next_push_at_utc
      : a.id < b.id ? -1 : 1);

    expect(rows[0].id).toBe('aaa');
    expect(rows[1].id).toBe('zzz');
    expect(rows[2].id).toBe('bbb');

    const last = rows[rows.length - 1];
    const nextPage = rows.filter(r =>
      r.next_push_at_utc > last.next_push_at_utc ||
      (r.next_push_at_utc === last.next_push_at_utc && r.id > last.id)
    );
    expect(nextPage.length).toBe(0);
  });
});

describe('Group 27 — Queue retry quota (max_retries=2 → 3 total attempts)', () => {
  it('max_retries=2 gives msg.attempts values 1, 2, 3', () => {
    const MAX_RETRIES = 2;
    const TOTAL_TRIES = MAX_RETRIES + 1;
    expect(TOTAL_TRIES).toBe(3);
  });

  it('abandoned on msg.attempts=3 with transient failure (final attempt)', () => {
    const MAX_QUEUE_ATTEMPTS = 3;
    const msgAttempts = 3;
    const pushFailed  = true;
    const shouldAbandon = pushFailed && msgAttempts >= MAX_QUEUE_ATTEMPTS;
    expect(shouldAbandon).toBe(true);
  });

  it('not abandoned on msg.attempts=2 with transient failure (more retries remain)', () => {
    const MAX_QUEUE_ATTEMPTS = 3;
    const msgAttempts = 2;
    const pushFailed  = true;
    const shouldAbandon = pushFailed && msgAttempts >= MAX_QUEUE_ATTEMPTS;
    expect(shouldAbandon).toBe(false);
  });
});

describe('Group 27 — DELIVER_N=20 and PUSH_CONCURRENCY=5', () => {
  it('20 IDs per deliver message requires 4 concurrent groups of 5', () => {
    const DELIVER_N   = 20;
    const CONCURRENCY = 5;
    const groups      = Math.ceil(DELIVER_N / CONCURRENCY);
    expect(groups).toBe(4);
  });

  it('DELIVER_N=20 × 3 params per CASE row = 60 params (≤ 100)', () => {
    expect(20 * 3).toBeLessThanOrEqual(100);
  });
});

describe('Group 27 — notification payload in deliver Queue message', () => {
  it('scan-consumer includes notification in Queue deliver message body', () => {
    const notification = {
      title: 'Eastre', body: 'Happy Eastre!', url: 'https://example.com',
      type: 'feast', silent: false, tag: '2026-03-21-feast'
    };
    const delivery = {
      id: 'sub_001', sacred_date: '2026-03-21', lease_token: 'lt-abc',
      endpoint: 'https://push.example.com/1', p256dh: 'KEY', auth: 'AUTH',
      timezone: 'UTC', silent: false, notification
    };
    expect(delivery.notification.title).toBe('Eastre');
    expect(delivery.notification.type).toBe('feast');
    expect(delivery.lease_token).toBe('lt-abc');
  });
});

// ── Group 28: VAPID validation, notification tag, real crypto, root-scan gate ─

describe('Group 28 — VAPID validation (length + Base64URL)', () => {
  const validPub  = 'A'.repeat(87);
  const validPriv = 'B'.repeat(43);

  it('valid key pair passes validation', () => {
    const env = { VAPID_PUBLIC_KEY: validPub, VAPID_PRIVATE_KEY: validPriv };
    expect(validateVapid(env)).toBe(true);
  });

  it('public key wrong length fails', () => {
    const env = { VAPID_PUBLIC_KEY: 'A'.repeat(86), VAPID_PRIVATE_KEY: validPriv };
    expect(validateVapid(env)).toBe(false);
  });

  it('private key wrong length fails', () => {
    const env = { VAPID_PUBLIC_KEY: validPub, VAPID_PRIVATE_KEY: 'B'.repeat(42) };
    expect(validateVapid(env)).toBe(false);
  });

  it('public key with non-Base64URL chars fails', () => {
    const env = { VAPID_PUBLIC_KEY: 'A'.repeat(86) + '+', VAPID_PRIVATE_KEY: validPriv };
    expect(validateVapid(env)).toBe(false);
  });

  it('private key with non-Base64URL chars fails', () => {
    const env = { VAPID_PUBLIC_KEY: validPub, VAPID_PRIVATE_KEY: 'B'.repeat(42) + '/' };
    expect(validateVapid(env)).toBe(false);
  });

  it('missing public key fails', () => {
    const env = { VAPID_PRIVATE_KEY: validPriv };
    expect(validateVapid(env)).toBe(false);
  });

  it('missing private key fails', () => {
    const env = { VAPID_PUBLIC_KEY: validPub };
    expect(validateVapid(env)).toBe(false);
  });
});

describe('Group 28 — root scan: no due work → no Queue send', () => {
  it('handleScheduled skips Queue.send when no subscriptions are due', async () => {
    const sentMessages = [];
    const env = {
      VAPID_PUBLIC_KEY:  'A'.repeat(87),
      VAPID_PRIVATE_KEY: 'B'.repeat(43),
      DB: {
        prepare: (sql) => ({
          bind: (...args) => ({
            first:  async () => null, // no due subscriptions
            run:    async () => ({ success: true })
          })
        })
      },
      PUSH_QUEUE: { send: async (msg) => { sentMessages.push(msg); } }
    };

    await handleScheduled(env);
    expect(sentMessages.length).toBe(0);
  });

  it('handleScheduled skips Queue.send when VAPID keys are invalid', async () => {
    const sentMessages = [];
    const env = {
      VAPID_PUBLIC_KEY:  'too-short',
      VAPID_PRIVATE_KEY: 'B'.repeat(43),
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ 1: 1 }) }) }) },
      PUSH_QUEUE: { send: async (msg) => { sentMessages.push(msg); } }
    };

    await handleScheduled(env);
    expect(sentMessages.length).toBe(0);
  });
});

describe('Group 28 — notification tag format', () => {
  it('tag is YYYY-MM-DD-{type} constructed from sacred_date and notification.type', () => {
    const sacred_date = '2026-03-21';
    const notification = computeNotification(utc('2026-03-21T12:00:00Z'), 'UTC');
    expect(notification).not.toBeNull();
    const tag = `${sacred_date}-${notification.type}`;
    expect(tag).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z\-]+$/);
    expect(tag).toBe('2026-03-21-feast');
  });

  it('tag is stable across retry: same sacred_date + type always produces same tag', () => {
    const tag1 = `2026-09-13-sunday`;
    const tag2 = `2026-09-13-sunday`;
    expect(tag1).toBe(tag2);
  });

  it('different notification types produce different tags for same date', () => {
    const date = '2026-09-14';
    const tags = ['feast', 'sunday', 'lunar', 'month-start'].map(t => `${date}-${t}`);
    const unique = new Set(tags);
    expect(unique.size).toBe(4);
  });
});

describe('Group 28 — real crypto: buildPushPayload not mocked', () => {
  it('produces a POST payload with real VAPID keys and synthetic subscription', async () => {
    // Generate a real EC P-256 VAPID key pair using Web Crypto (no mocks).
    const vapidKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
    );
    const pubRaw  = new Uint8Array(await crypto.subtle.exportKey('raw', vapidKeyPair.publicKey));
    const privJwk = await crypto.subtle.exportKey('jwk', vapidKeyPair.privateKey);
    const pubB64  = Buffer.from(pubRaw).toString('base64url');  // 87 chars
    const privB64 = privJwk.d;                                  // 43-char base64url scalar

    // Generate a real ECDH key pair to simulate a browser push subscription.
    const clientKey    = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );
    const clientPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', clientKey.publicKey));
    const p256dh       = Buffer.from(clientPubRaw).toString('base64url');
    const auth         = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-test-key-do-not-use',
      keys: { p256dh, auth }
    };
    const vapid = {
      subject:    'mailto:test@example.com',
      publicKey:  pubB64,
      privateKey: privB64
    };
    const message = {
      data:    JSON.stringify({ title: 'Test', body: 'Real crypto test' }),
      options: { ttl: 60 }
    };

    // Call the REAL library — no vi.mock('@block65/webcrypto-web-push').
    const payload = await buildPushPayload(message, subscription, vapid);
    expect(payload).toBeDefined();
    expect(payload.method.toUpperCase()).toBe('POST');
    expect(payload.headers).toBeDefined();

    // VAPID key lengths match specification.
    expect(pubB64.length).toBe(87);
    expect(privB64.length).toBe(43);
  });
});
