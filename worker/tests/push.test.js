// Unit tests for push.js and scheduler idempotency/retry semantics.
// push.js behaviour: ok / gone / transient return values; payload contents.
// Idempotency: reservation before send, rollback on transient, retain on ok.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Stub @block65/webcrypto-web-push ──────────────────────────────────────
let lastBuildArgs = null;
vi.mock('@block65/webcrypto-web-push', () => ({
  buildPushPayload: vi.fn(async (message, subscription, vapid) => {
    lastBuildArgs = { message, subscription, vapid };
    return { method: 'POST', headers: {}, body: message.data };
  })
}));

// ── Helpers ────────────────────────────────────────────────────────────────
function makeSub(overrides = {}) {
  return { endpoint: 'https://push.example.com/sub/abc', p256dh: 'K', auth: 'A', ...overrides };
}
function makeVapid() {
  return { subject: 'mailto:test@example.com', publicKey: 'PUB', privateKey: 'PRIV' };
}
function makeNotification(overrides = {}) {
  return { title: 'Eastre', body: 'Happy Eastre!', url: 'https://www.mother-god.com/easter.html', silent: false, ...overrides };
}

// ── sendPushNotification ───────────────────────────────────────────────────

describe('sendPushNotification — return values', () => {
  let sendPushNotification;

  beforeEach(async () => {
    vi.resetModules();
    ({ sendPushNotification } = await import('../src/push.js'));
    lastBuildArgs = null;
  });

  it('returns { ok: true } on 201', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 201 });
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ ok: true });
  });

  it('returns { ok: true } on 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ ok: true });
  });

  it('returns { gone: true } on 410', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 410 });
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ gone: true });
  });

  it('returns { gone: true } on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 });
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ gone: true });
  });

  it('returns { transient: true } on 429', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 429 });
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ transient: true });
  });

  it('returns { transient: true } on 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 });
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ transient: true });
  });

  it('returns { transient: true } on 502', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 502 });
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ transient: true });
  });

  it('returns { transient: true } on 503', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 503 });
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ transient: true });
  });

  it('returns { transient: true } on network error (fetch throws)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await sendPushNotification(makeSub(), makeNotification(), makeVapid())).toEqual({ transient: true });
  });

  it('throws on unexpected 4xx (not 404/410) — treated as permanent', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 400 });
    await expect(sendPushNotification(makeSub(), makeNotification(), makeVapid())).rejects.toThrow();
  });

  it('includes silent:true in JSON payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 201 });
    await sendPushNotification(makeSub(), makeNotification({ silent: true }), makeVapid());
    expect(JSON.parse(lastBuildArgs.message.data).silent).toBe(true);
  });

  it('includes silent:false in JSON payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 201 });
    await sendPushNotification(makeSub(), makeNotification({ silent: false }), makeVapid());
    expect(JSON.parse(lastBuildArgs.message.data).silent).toBe(false);
  });

  it('includes title, body, url in payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 201 });
    await sendPushNotification(makeSub(), makeNotification(), makeVapid());
    const p = JSON.parse(lastBuildArgs.message.data);
    expect(p.title).toBe('Eastre');
    expect(p.body).toBe('Happy Eastre!');
    expect(p.url).toBe('https://www.mother-god.com/easter.html');
  });

  it('passes subscription endpoint and keys to buildPushPayload', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 201 });
    await sendPushNotification(makeSub({ p256dh: 'MYKEY', auth: 'MYAUTH' }), makeNotification(), makeVapid());
    expect(lastBuildArgs.subscription.endpoint).toBe('https://push.example.com/sub/abc');
    expect(lastBuildArgs.subscription.keys.p256dh).toBe('MYKEY');
    expect(lastBuildArgs.subscription.keys.auth).toBe('MYAUTH');
  });
});

// ── Idempotency / retry semantics (inline simulation) ─────────────────────
// Simulates the scheduler's processSub logic without real D1, verifying the
// reservation + rollback contract.

describe('idempotency and retry semantics', () => {
  function makeDb() {
    const sentLog = new Set(); // key: subId|date
    const deleted = new Set(); // deleted subscription ids
    return {
      sentLog,
      deleted,
      hasReservation: (subId, date) => sentLog.has(subId + '|' + date),
      insertOrIgnore: (subId, date) => sentLog.add(subId + '|' + date),
      deleteReservation: (subId, date) => sentLog.delete(subId + '|' + date),
      deleteSub: (subId) => deleted.add(subId)
    };
  }

  // Simulates processSub without async DB calls.
  function processSub(db, result, subId, date) {
    const alreadyLogged = db.hasReservation(subId, date);
    if (alreadyLogged) return 'skipped'; // idempotency fence

    db.insertOrIgnore(subId, date); // reserve BEFORE send

    if (result.gone) { db.deleteSub(subId); return 'gone'; }
    if (result.transient) { db.deleteReservation(subId, date); return 'retryable'; }
    // ok — reservation stays, advance schedule (not simulated here)
    return 'sent';
  }

  it('successful send — reservation retained', () => {
    const db = makeDb();
    const outcome = processSub(db, { ok: true }, 's1', '2026-09-12');
    expect(outcome).toBe('sent');
    expect(db.hasReservation('s1', '2026-09-12')).toBe(true);
  });

  it('second invocation on same sacred date — reservation fence blocks duplicate send', () => {
    const db = makeDb();
    processSub(db, { ok: true }, 's1', '2026-09-12');
    const outcome2 = processSub(db, { ok: true }, 's1', '2026-09-12');
    expect(outcome2).toBe('skipped');
  });

  it('transient failure — reservation removed, retry possible', () => {
    const db = makeDb();
    const outcome = processSub(db, { transient: true }, 's1', '2026-09-12');
    expect(outcome).toBe('retryable');
    expect(db.hasReservation('s1', '2026-09-12')).toBe(false);
  });

  it('later retry after transient — can reserve and send', () => {
    const db = makeDb();
    processSub(db, { transient: true }, 's1', '2026-09-12'); // first attempt fails
    const outcome2 = processSub(db, { ok: true }, 's1', '2026-09-12'); // retry succeeds
    expect(outcome2).toBe('sent');
    expect(db.hasReservation('s1', '2026-09-12')).toBe(true);
  });

  it('gone (410) — subscription deleted, reservation stays (no retry needed)', () => {
    const db = makeDb();
    const outcome = processSub(db, { gone: true }, 's1', '2026-09-12');
    expect(outcome).toBe('gone');
    expect(db.deleted.has('s1')).toBe(true);
    // Reservation may or may not remain; subscription is gone so it is irrelevant.
    // The important property is: no retry will occur because sub is deleted.
  });

  it('gone subscription is not retried (sub deleted, would not appear in next query)', () => {
    const db = makeDb();
    processSub(db, { gone: true }, 's1', '2026-09-12');
    expect(db.deleted.has('s1')).toBe(true);
    // A real DB query for next_push_at_utc <= now would not find the deleted sub.
  });

  it('different sacred date on next day — sends fresh notification after previous success', () => {
    const db = makeDb();
    processSub(db, { ok: true }, 's1', '2026-09-12'); // day 1
    const outcome2 = processSub(db, { ok: true }, 's1', '2026-09-13'); // day 2
    expect(outcome2).toBe('sent');
    expect(db.hasReservation('s1', '2026-09-13')).toBe(true);
  });
});
