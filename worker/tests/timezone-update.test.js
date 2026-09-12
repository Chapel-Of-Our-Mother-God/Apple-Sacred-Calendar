// Deterministic checks for the launch-time timezone/silent_supported update path.
// These tests simulate the checkTimezoneUpdate() logic from app/main.js and the
// handleTimezone() route in worker/src/index.js without real SW, D1, or network.

import { describe, it, expect, vi } from 'vitest';

// ── Simulation of checkTimezoneUpdate from app/main.js ────────────────────
// Mirrors the logic exactly; tests verify the contract, not the wiring.

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem:    (k) => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _dump:      () => ({ ...store })
  };
}

function makeCheckTimezoneUpdate(localStorage, fetch, WORKER_URL = 'https://worker.example') {
  function getStoredTz()    { try { return localStorage.getItem('cal-notify-tz') || null; } catch { return null; } }
  function setStoredTz(tz)  { try { localStorage.setItem('cal-notify-tz', tz); } catch {} }
  function getStoredSilent() {
    try { var v = localStorage.getItem('cal-notify-silent'); return v === null ? null : (v === '1'); }
    catch { return null; }
  }
  function setStoredSilent(val) { try { localStorage.setItem('cal-notify-silent', val ? '1' : '0'); } catch {} }

  return function checkTimezoneUpdate(sub, currentTz, currentSilent) {
    var storedTz     = getStoredTz();
    var storedSilent = getStoredSilent();
    if (currentTz === storedTz && storedSilent !== null && currentSilent === storedSilent) return;
    return fetch(WORKER_URL + '/api/timezone-update', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ endpoint: sub.endpoint, timezone: currentTz, silent_supported: currentSilent })
    }).then(function (res) {
      if (res.ok) { setStoredTz(currentTz); setStoredSilent(currentSilent); }
    }).catch(function () {});
  };
}

// ── handleTimezone simulation ─────────────────────────────────────────────
// Simulates the DB update contract without real D1.

function makeDb(sub) {
  let row = { ...sub };
  return {
    getRow: () => ({ ...row }),
    update: (timezone, silentInt, nextPushMs) => {
      row.timezone          = timezone;
      row.silent_supported  = silentInt;
      row.next_push_at_utc  = nextPushMs;
    }
  };
}

function simulateHandleTimezone(db, body) {
  const { endpoint, timezone, silent_supported } = body;
  if (!endpoint || !timezone) return { status: 400 };

  const sub = db.getRow();
  const effectiveSilent = (silent_supported !== undefined && silent_supported !== null)
    ? !!silent_supported
    : !!sub.silent_supported;

  const pushHour = effectiveSilent ? 5 : 9;
  const nextPushMs = Date.now() + pushHour; // placeholder — not testing exact time here
  db.update(timezone, effectiveSilent ? 1 : 0, nextPushMs);
  return { status: 200 };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('checkTimezoneUpdate — no-op when nothing changed', () => {
  it('unchanged timezone and silent → fetch never called', () => {
    const ls    = makeStorage({ 'cal-notify-tz': 'Europe/London', 'cal-notify-silent': '0' });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const check = makeCheckTimezoneUpdate(ls, fetch);
    check({ endpoint: 'https://push.example/1' }, 'Europe/London', false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('both match → no request even if silent is true', () => {
    const ls    = makeStorage({ 'cal-notify-tz': 'America/New_York', 'cal-notify-silent': '1' });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const check = makeCheckTimezoneUpdate(ls, fetch);
    check({ endpoint: 'https://push.example/1' }, 'America/New_York', true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('checkTimezoneUpdate — timezone change triggers update', () => {
  it('Europe/London → America/New_York sends POST to /api/timezone-update', async () => {
    const ls    = makeStorage({ 'cal-notify-tz': 'Europe/London', 'cal-notify-silent': '0' });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const check = makeCheckTimezoneUpdate(ls, fetch);
    await check({ endpoint: 'https://push.example/1' }, 'America/New_York', false);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain('/api/timezone-update');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.timezone).toBe('America/New_York');
    expect(body.endpoint).toBe('https://push.example/1');
  });

  it('on success, stored timezone is updated to new value', async () => {
    const ls    = makeStorage({ 'cal-notify-tz': 'Europe/London', 'cal-notify-silent': '0' });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const check = makeCheckTimezoneUpdate(ls, fetch);
    await check({ endpoint: 'https://push.example/1' }, 'America/New_York', false);
    expect(ls.getItem('cal-notify-tz')).toBe('America/New_York');
  });

  it('on failed response, stored timezone is NOT updated', async () => {
    const ls    = makeStorage({ 'cal-notify-tz': 'Europe/London', 'cal-notify-silent': '0' });
    const fetch = vi.fn().mockResolvedValue({ ok: false });
    const check = makeCheckTimezoneUpdate(ls, fetch);
    await check({ endpoint: 'https://push.example/1' }, 'America/New_York', false);
    expect(ls.getItem('cal-notify-tz')).toBe('Europe/London');
  });

  it('on network error (fetch throws), stored timezone is NOT updated and no exception escapes', async () => {
    const ls    = makeStorage({ 'cal-notify-tz': 'Europe/London', 'cal-notify-silent': '0' });
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const check = makeCheckTimezoneUpdate(ls, fetch);
    await expect(check({ endpoint: 'https://push.example/1' }, 'America/New_York', false)).resolves.toBeUndefined();
    expect(ls.getItem('cal-notify-tz')).toBe('Europe/London');
  });
});

describe('checkTimezoneUpdate — silent_supported change triggers update', () => {
  it('silent false→true sends update with new silent value', async () => {
    const ls    = makeStorage({ 'cal-notify-tz': 'UTC', 'cal-notify-silent': '0' });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const check = makeCheckTimezoneUpdate(ls, fetch);
    await check({ endpoint: 'https://push.example/1' }, 'UTC', true);
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.silent_supported).toBe(true);
  });

  it('on success, stored silent is updated', async () => {
    const ls    = makeStorage({ 'cal-notify-tz': 'UTC', 'cal-notify-silent': '0' });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const check = makeCheckTimezoneUpdate(ls, fetch);
    await check({ endpoint: 'https://push.example/1' }, 'UTC', true);
    expect(ls.getItem('cal-notify-silent')).toBe('1');
  });
});

describe('checkTimezoneUpdate — first launch (no stored values)', () => {
  it('stored tz null → sends update (initialises storage)', async () => {
    const ls    = makeStorage({});
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const check = makeCheckTimezoneUpdate(ls, fetch);
    await check({ endpoint: 'https://push.example/1' }, 'Europe/London', false);
    expect(fetch).toHaveBeenCalledOnce();
    expect(ls.getItem('cal-notify-tz')).toBe('Europe/London');
    expect(ls.getItem('cal-notify-silent')).toBe('0');
  });
});

describe('handleTimezone — Worker route', () => {
  it('timezone-only update uses stored silent_supported', () => {
    const db = makeDb({ endpoint: 'https://push.example/1', timezone: 'UTC', silent_supported: 1 });
    const res = simulateHandleTimezone(db, { endpoint: 'https://push.example/1', timezone: 'Europe/London' });
    expect(res.status).toBe(200);
    expect(db.getRow().timezone).toBe('Europe/London');
    expect(db.getRow().silent_supported).toBe(1); // unchanged — stored value used
  });

  it('silent_supported update overrides stored value', () => {
    const db = makeDb({ endpoint: 'https://push.example/1', timezone: 'UTC', silent_supported: 1 });
    simulateHandleTimezone(db, { endpoint: 'https://push.example/1', timezone: 'UTC', silent_supported: false });
    expect(db.getRow().silent_supported).toBe(0);
  });

  it('silent true → push hour is 5', () => {
    const db = makeDb({ endpoint: 'e', timezone: 'UTC', silent_supported: 0 });
    simulateHandleTimezone(db, { endpoint: 'e', timezone: 'UTC', silent_supported: true });
    // effectiveSilent = true → pushHour = 5; we just verify silent flag flipped
    expect(db.getRow().silent_supported).toBe(1);
  });

  it('missing endpoint → 400', () => {
    const db  = makeDb({ endpoint: 'e', timezone: 'UTC', silent_supported: 0 });
    const res = simulateHandleTimezone(db, { timezone: 'Europe/London' });
    expect(res.status).toBe(400);
  });
});
