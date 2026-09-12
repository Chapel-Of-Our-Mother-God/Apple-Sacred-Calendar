// Unit tests for scheduler utilities (worker/src/util.js).
// Tests nextPushAtUtc and sacredDateKey in isolation — no D1, no network.

import { describe, it, expect } from 'vitest';
import { nextPushAtUtc, sacredDateKey, localComponents } from '../src/util.js';

// Import calendar files so globalThis.SacredCalendar is available for effectiveLocalDate.
import '../../calendar/data.js';
import '../../calendar/engine.js';
const C = globalThis.SacredCalendar;

function utc(iso) { return new Date(iso); }

// ── sacredDateKey ──────────────────────────────────────────────────────────

describe('sacredDateKey', () => {
  it('formats UTC-at-noon Date as YYYY-MM-DD', () => {
    const eld = new Date(Date.UTC(2026, 5, 10, 12, 0, 0)); // Jun 10 2026 noon UTC
    expect(sacredDateKey(eld)).toBe('2026-06-10');
  });

  it('formats Jan 1', () => {
    const eld = new Date(Date.UTC(2027, 0, 1, 12, 0, 0));
    expect(sacredDateKey(eld)).toBe('2027-01-01');
  });

  it('pads month and day', () => {
    const eld = new Date(Date.UTC(2026, 2, 5, 12, 0, 0)); // Mar 5
    expect(sacredDateKey(eld)).toBe('2026-03-05');
  });
});

// ── localComponents ────────────────────────────────────────────────────────

describe('localComponents', () => {
  it('London noon UTC in summer (BST = UTC+1) → hour 13', () => {
    const c = localComponents(utc('2026-06-10T12:00:00Z'), 'Europe/London');
    expect(c.hours).toBe(13); // 12:00 UTC + 1h BST = 13:00 local
    expect(c.date).toBe(10);
  });

  it('London noon UTC in winter (GMT = UTC+0) → hour 12', () => {
    const c = localComponents(utc('2026-01-10T12:00:00Z'), 'Europe/London');
    expect(c.hours).toBe(12);
    expect(c.date).toBe(10);
  });

  it('New York noon UTC in summer (EDT = UTC-4) → hour 8', () => {
    const c = localComponents(utc('2026-06-10T12:00:00Z'), 'America/New_York');
    expect(c.hours).toBe(8);
  });

  it('New York noon UTC in winter (EST = UTC-5) → hour 7', () => {
    const c = localComponents(utc('2026-01-10T12:00:00Z'), 'America/New_York');
    expect(c.hours).toBe(7);
  });
});

// ── nextPushAtUtc ──────────────────────────────────────────────────────────

describe('nextPushAtUtc', () => {
  // All tests: effectiveUtc is a UTC-at-noon Date representing the current effective day.
  // nextPushAtUtc returns the UTC instant of pushHour:00 local on the NEXT calendar day.

  it('London summer (BST UTC+1), pushHour=5 → UTC 04:00 next day', () => {
    // Effective date: Jun 10 2026 (BST = UTC+1)
    // pushHour=5 local = 04:00 UTC
    const eld  = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
    const next = nextPushAtUtc(eld, 'Europe/London', 5);
    expect(next.getUTCDate()).toBe(11);   // Jun 11
    expect(next.getUTCHours()).toBe(4);   // 04:00 UTC = 05:00 BST
  });

  it('London winter (GMT UTC+0), pushHour=5 → UTC 05:00 next day', () => {
    const eld  = new Date(Date.UTC(2026, 0, 10, 12, 0, 0)); // Jan 10 2026
    const next = nextPushAtUtc(eld, 'Europe/London', 5);
    expect(next.getUTCDate()).toBe(11);
    expect(next.getUTCHours()).toBe(5);   // 05:00 UTC = 05:00 GMT
  });

  it('New York summer (EDT UTC-4), pushHour=5 → UTC 09:00 next day', () => {
    const eld  = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
    const next = nextPushAtUtc(eld, 'America/New_York', 5);
    expect(next.getUTCDate()).toBe(11);
    expect(next.getUTCHours()).toBe(9);   // 05:00 EDT = 09:00 UTC
  });

  it('New York winter (EST UTC-5), pushHour=9 (non-silent) → UTC 14:00 next day', () => {
    const eld  = new Date(Date.UTC(2026, 0, 10, 12, 0, 0));
    const next = nextPushAtUtc(eld, 'America/New_York', 9);
    expect(next.getUTCDate()).toBe(11);
    expect(next.getUTCHours()).toBe(14);  // 09:00 EST = 14:00 UTC
  });

  it('UTC timezone, pushHour=5 → UTC 05:00 next day', () => {
    const eld  = new Date(Date.UTC(2026, 2, 21, 12, 0, 0)); // Mar 21 2026
    const next = nextPushAtUtc(eld, 'UTC', 5);
    expect(next.getUTCDate()).toBe(22);
    expect(next.getUTCHours()).toBe(5);
  });

  it('result is always on the next calendar day', () => {
    const eld  = new Date(Date.UTC(2026, 8, 11, 12, 0, 0)); // Sep 11 2026
    const next = nextPushAtUtc(eld, 'UTC', 5);
    expect(next.getUTCDate()).toBe(12);
  });
});

// ── Integration: effectiveLocalDate + sacredDateKey ────────────────────────

describe('effectiveLocalDate + sacredDateKey integration', () => {
  it('London 04:59 BST on Jun 10 2026 → eff Jun 9 → key 2026-06-09', () => {
    const now = utc('2026-06-10T03:59:00Z'); // 04:59 BST
    const eld = C.effectiveLocalDate(now, 'Europe/London');
    expect(sacredDateKey(eld)).toBe('2026-06-09');
  });

  it('London 05:01 BST on Jun 10 2026 → eff Jun 10 → key 2026-06-10', () => {
    const now = utc('2026-06-10T04:01:00Z'); // 05:01 BST
    const eld = C.effectiveLocalDate(now, 'Europe/London');
    expect(sacredDateKey(eld)).toBe('2026-06-10');
  });

  it('New York 04:59 EST on Jan 10 2026 → eff Jan 9 → key 2026-01-09', () => {
    const now = utc('2026-01-10T09:59:00Z'); // 04:59 EST
    const eld = C.effectiveLocalDate(now, 'America/New_York');
    expect(sacredDateKey(eld)).toBe('2026-01-09');
  });
});
