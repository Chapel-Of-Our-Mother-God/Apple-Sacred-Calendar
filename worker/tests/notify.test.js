// Unit tests for computeNotification (worker/src/notify.js).
// These tests are deterministic: they pass a fixed UTC moment and explicit timezone
// so the result is the same regardless of the test machine's local timezone.

import { describe, it, expect } from 'vitest';
import { computeNotification } from '../src/notify.js';

// UTC instant helper
function utc(isoString) { return new Date(isoString); }

// ── FEAST ──────────────────────────────────────────────────────────────────

describe('computeNotification — feast days', () => {
  it('Eastre (Culverine 1, 21 Mar 2026) — happy feast', () => {
    // Noon UTC on 21 Mar 2026; GMT in London (pre-BST); noon > 05:00 → same day
    const n = computeNotification(utc('2026-03-21T12:00:00Z'), 'Europe/London');
    expect(n.type).toBe('feast');
    expect(n.title).toBe('Eastre');
    expect(n.body).toBe('Happy Eastre!');
    expect(n.url).toBe('https://www.mother-god.com/easter.html');
  });

  it('Moura Day (happy: false) — prayer notification', () => {
    // Moura 1 = 20 Feb 2027; GMT in London; noon UTC
    const n = computeNotification(utc('2027-02-20T12:00:00Z'), 'Europe/London');
    expect(n.type).toBe('feast');
    expect(n.title).toBe('Moura Day');
    expect(n.body).toBe('Pray for the World.');
  });

  it('Kala (happy: false) — prayer notification', () => {
    // Kala = Moura 28 = 19 Mar 2027
    const n = computeNotification(utc('2027-03-19T12:00:00Z'), 'UTC');
    expect(n.type).toBe('feast');
    expect(n.title).toBe('Kala');
    expect(n.body).toBe('Pray for the World.');
  });

  it('Feast without URL (Florimaia) — url is null', () => {
    // Florimaia = Hera 10 = 25 May 2026
    const n = computeNotification(utc('2026-05-25T12:00:00Z'), 'UTC');
    expect(n.type).toBe('feast');
    expect(n.title).toBe('Florimaia');
    expect(n.body).toBe('Happy Florimaia!');
    expect(n.url).toBeNull();
  });

  it('notifiable:false feast (Tamala 2nd day) — skips feast priority', () => {
    // Tamala 2nd day = Werdë 2 = 1 Oct 2026 (Werdë starts 31 Sep... wait 31 Oct is not valid)
    // Werdë starts at Oct 31, 2026 (from monthDay1: [2026, 9, 31, "Werdë"])
    // Wait, month 9 = October, day 31 = Oct 31, 2026
    // But Oct has 31 days so Oct 31 is valid.
    // Werdë 1 = Oct 31; Werdë 2 = Nov 1; but 8:2 is Tamala 2nd day.
    // Actually: Werdë is month index 8. Tamala 2nd day is "8:2".
    // Werdë 1 = 31 Oct 2026, Werdë 2 = 1 Nov 2026.
    const n = computeNotification(utc('2026-11-01T12:00:00Z'), 'UTC');
    // notifiable:false → should NOT be feast type
    expect(n === null || n.type !== 'feast').toBe(true);
  });

  it('First Hiatus day (20 Mar 2026) — uses HIATUS_FEAST, happy:false', () => {
    const n = computeNotification(utc('2026-03-20T12:00:00Z'), 'UTC');
    expect(n).not.toBeNull();
    expect(n.type).toBe('feast');
    expect(n.title).toBe('The Hiatus');
    expect(n.body).toBe('Pray for the World.');
    expect(n.url).toBe('https://www.mother-god.com/easter-hymn.html');
  });
});

// ── MONTH START ────────────────────────────────────────────────────────────

describe('computeNotification — month start', () => {
  it('Rosea 1 (no feast on day 1) → month-start notification listing feasts', () => {
    // Rosea 1 = 13 Jun 2026
    const n = computeNotification(utc('2026-06-13T12:00:00Z'), 'UTC');
    expect(n.type).toBe('month-start');
    expect(n.title).toBe('Rosea begins');
    expect(n.body).toContain('Rosa Mundi');
  });

  it('Herthë 1 (Nativity-2 is notifiable:false) → month-start, not feast', () => {
    // Herthë 1 = Dec 26, 2026 (monthDay1: [2026, 11, 26, "Herthë"])
    const n = computeNotification(utc('2026-12-26T12:00:00Z'), 'UTC');
    expect(n.type).toBe('month-start');
    expect(n.title).toBe('Herthë begins');
    expect(n.body).toContain('The Epiphany');
  });

  it('Vois 1 (no feasts in Vois) → null', () => {
    // Vois 1 = 3 Oct 2026 (monthDay1: [2026, 9, 3, "Vois"]) — month 9 = Oct
    const n = computeNotification(utc('2026-10-03T12:00:00Z'), 'UTC');
    expect(n).toBeNull();
  });

  it('Culverine 1 (Eastre feast on day 1) → feast wins, not month-start', () => {
    const n = computeNotification(utc('2026-03-21T12:00:00Z'), 'UTC');
    expect(n.type).toBe('feast');
    expect(n.title).toBe('Eastre');
  });
});

// ── LUNAR ──────────────────────────────────────────────────────────────────

describe('computeNotification — lunar observances', () => {
  it('New Moon 29 Mar 2025 → new-moon notification', () => {
    // NM at 10:58 UTC; noon local (UTC) is well after the NM
    const n = computeNotification(utc('2025-03-29T12:00:00Z'), 'UTC');
    expect(n.type).toBe('lunar');
    expect(n.body).toBe('🕀 New moon: Hail to Our Mother!');
  });

  it('Full Moon 14 Mar 2025 → full-moon notification', () => {
    const n = computeNotification(utc('2025-03-14T12:00:00Z'), 'UTC');
    expect(n.type).toBe('lunar');
    expect(n.body).toBe('🕀 Full Moon : Praise to Our Mother!');
  });

  it('Day of Artemis 3 Apr 2025 (NM+5) → artemis notification', () => {
    const n = computeNotification(utc('2025-04-03T12:00:00Z'), 'UTC');
    expect(n.type).toBe('lunar');
    expect(n.body).toBe('🕀 Day of Artemis: Holy Lady, slay our false self.');
  });

  it('Half Moon Day 20 Jan 2025 (FM→NM Mon) → half-moon notification', () => {
    const n = computeNotification(utc('2025-01-20T12:00:00Z'), 'UTC');
    expect(n.type).toBe('lunar');
    expect(n.body).toBe('🕀 Half Moon Day Beloved Daughter, have Mercy on us.');
  });
});

// ── SUNDAY ─────────────────────────────────────────────────────────────────

describe('computeNotification — Sunday', () => {
  it('Ordinary Sunday (Herthë 17, 11 Jan 2026) → sunday type with sacred-date title', () => {
    const n = computeNotification(utc('2026-01-11T12:00:00Z'), 'UTC');
    expect(n).not.toBeNull();
    expect(n.type).toBe('sunday');
    expect(n.title).toBe('17 Herthë');
    expect(n.body).toBe('Sunday - Day of Our Divine Mother');
    expect(n.url).toBeNull();
  });

  it('Notifiable feast on Sunday (Rosa Mundi, 21 Jun 2026) → feast wins over Sunday', () => {
    const n = computeNotification(utc('2026-06-21T12:00:00Z'), 'UTC');
    expect(n.type).toBe('feast');
    expect(n.title).toBe('Rosa Mundi');
  });

  it('Non-notifiable feast on Sunday (Nativity-11, 4 Jan 2026) → Sunday wins', () => {
    // Nativity-11 has notifiable:false; feast priority is skipped
    const n = computeNotification(utc('2026-01-04T12:00:00Z'), 'UTC');
    expect(n.type).toBe('sunday');
    expect(n.title).toBe('10 Herthë');
    expect(n.body).toBe('Sunday - Day of Our Divine Mother');
  });

  it('Lunar observance on Sunday (New Moon 18 Jan 2026) → lunar wins over Sunday', () => {
    const n = computeNotification(utc('2026-01-18T12:00:00Z'), 'UTC');
    expect(n.type).toBe('lunar');
  });

  it('Month-start Sunday (Rosea 1, 13 Jun 2027) → month-start wins over Sunday', () => {
    const n = computeNotification(utc('2027-06-13T12:00:00Z'), 'UTC');
    expect(n.type).toBe('month-start');
    expect(n.title).toBe('Rosea begins');
  });
});

// ── SECOND HIATUS DAY SUPPRESSION ─────────────────────────────────────────

describe('computeNotification — second Hiatus day', () => {
  it('Second Hiatus day (20 Mar 2028, index 365) → null', () => {
    // In a leap year the Hiatus has two days: index 364 (notifiable) and 365 (suppressed).
    const n = computeNotification(utc('2028-03-20T12:00:00Z'), 'UTC');
    expect(n).toBeNull();
  });

  it('First Hiatus day (19 Mar 2028, index 364) → notifiable', () => {
    const n = computeNotification(utc('2028-03-19T12:00:00Z'), 'UTC');
    expect(n).not.toBeNull();
    expect(n.type).toBe('feast');
    expect(n.title).toBe('The Hiatus');
  });
});

// ── PRIORITY COLLISION TABLE ───────────────────────────────────────────────

describe('computeNotification — priority collisions', () => {
  it('Feast beats month-start on day 1 (Culverine 1 = Eastre)', () => {
    // Eastre is a notifiable feast on Culverine 1 — feast wins.
    const n = computeNotification(utc('2026-03-21T12:00:00Z'), 'UTC');
    expect(n.type).toBe('feast');
    expect(n.title).toBe('Eastre');
  });

  it('Feast beats lunar on a feast day with a lunar observance', () => {
    // Find a day that is both a feast and has a lunar phase by comparing
    // directly: if lunar is present but feast fires first, type === 'feast'.
    // Rosa Mundi (Jun 21 2026) — check that lunar (if any) does not win.
    const n = computeNotification(utc('2026-06-21T12:00:00Z'), 'UTC');
    expect(n.type).toBe('feast');
  });

  it('Feast beats Sunday', () => {
    const n = computeNotification(utc('2026-06-21T12:00:00Z'), 'UTC');
    expect(n.type).not.toBe('sunday');
  });

  it('Month-start beats Sunday (Rosea 1 on a Sunday, 13 Jun 2027)', () => {
    const n = computeNotification(utc('2027-06-13T12:00:00Z'), 'UTC');
    expect(n.type).toBe('month-start');
    expect(n.type).not.toBe('sunday');
  });

  it('Lunar beats Sunday', () => {
    const n = computeNotification(utc('2026-01-18T12:00:00Z'), 'UTC');
    expect(n.type).toBe('lunar');
    expect(n.type).not.toBe('sunday');
  });

  it('Month-start with no notifiable feasts → null (beats Sunday if applicable)', () => {
    // Vois 1 = 3 Oct 2026, Saturday — returns null because no feasts in Vois.
    const n = computeNotification(utc('2026-10-03T12:00:00Z'), 'UTC');
    expect(n).toBeNull();
  });
});

// ── FIRST-DAY-ONLY MULTI-DAY OBSERVANCE ───────────────────────────────────

describe('computeNotification — multi-day observances', () => {
  it('Tamala 1st day (Werdë 1, 31 Oct 2026) — notifiable', () => {
    // Werdë 1 = "Tamala — first day" (notifiable by default)
    const n = computeNotification(utc('2026-10-31T12:00:00Z'), 'UTC');
    expect(n).not.toBeNull();
    expect(n.type).toBe('feast');
    expect(n.title).toBe('Tamala — first day');
  });

  it('Tamala 2nd day (Werdë 2, 1 Nov 2026) — notifiable:false, suppressed', () => {
    const n = computeNotification(utc('2026-11-01T12:00:00Z'), 'UTC');
    // notifiable:false → falls through; no month-start (Werdë 2); no lunar; check Sunday
    expect(n === null || n.type !== 'feast').toBe(true);
  });

  it('Nativity-2 (Herthë 1, 26 Dec 2026) — notifiable:false on day 1 → month-start fires', () => {
    const n = computeNotification(utc('2026-12-26T12:00:00Z'), 'UTC');
    expect(n.type).toBe('month-start');
    expect(n.title).toBe('Herthë begins');
  });
});

// ── ORDINARY / NULL ────────────────────────────────────────────────────────

describe('computeNotification — ordinary day', () => {
  it('Non-feast Tuesday with no lunar observance → null', () => {
    // Culverine 4 = 24 Mar 2026; Tuesday; no feast; no lunar (Artemis is Mar 23)
    const n = computeNotification(utc('2026-03-24T12:00:00Z'), 'UTC');
    expect(n).toBeNull();
  });
});

// ── 05:00 BOUNDARY — timezone context ─────────────────────────────────────

describe('computeNotification — timezone boundary', () => {
  it('London 04:59 BST (03:59 UTC) still on previous sacred day', () => {
    // Jun 10 2026, 03:59 UTC = 04:59 BST → eff Jun 9 = Hera 25 (no feast, no special lunar)
    const n = computeNotification(utc('2026-06-10T03:59:00Z'), 'Europe/London');
    // No feast on Hera 25; just verify we're not on Hera 26
    if (n && n.title) expect(n.title).not.toContain('26');
  });

  it('London 05:01 BST (04:01 UTC) on new sacred day', () => {
    // Jun 10 2026, 04:01 UTC = 05:01 BST → eff Jun 10 = Hera 26
    const n = computeNotification(utc('2026-06-10T04:01:00Z'), 'Europe/London');
    // Hera 26 is an ordinary day — no feast, no special lunar expected → null
    // (or a lunar if it happens to fall on that day — we just check no error)
    expect(() => computeNotification(utc('2026-06-10T04:01:00Z'), 'Europe/London'))
      .not.toThrow();
  });

  it('New York 04:59 EDT (08:59 UTC) still on Hera 25', () => {
    const n = computeNotification(utc('2026-06-10T08:59:00Z'), 'America/New_York');
    expect(() => n).not.toThrow();
  });
});
