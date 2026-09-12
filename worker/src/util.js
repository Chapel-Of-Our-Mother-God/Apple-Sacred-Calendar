// Shared utilities for the notification Worker.
// localComponents duplicates the private helper from calendar/engine.js so the
// Worker can compute timezone-aware times without exposing engine internals.

// Returns { year, month (0-based), date, hours } for a UTC instant in a given IANA timezone.
export function localComponents(utcMoment, timezone) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false
  }).formatToParts(utcMoment).forEach(p => { parts[p.type] = p.value; });
  let h = parseInt(parts.hour, 10);
  if (h === 24) h = 0;
  return {
    year:  parseInt(parts.year,  10),
    month: parseInt(parts.month, 10) - 1,
    date:  parseInt(parts.day,   10),
    hours: h
  };
}

// Format the effective local date (returned by C.effectiveLocalDate with timezone) as
// "YYYY-MM-DD". In Worker context that Date is UTC-at-noon so .getUTC*() = local values.
export function sacredDateKey(effectiveUtc) {
  const y = effectiveUtc.getUTCFullYear();
  const m = String(effectiveUtc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(effectiveUtc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Compute the UTC instant of pushHour:00 local on the day AFTER the effective local date.
// effectiveUtc: Date returned by C.effectiveLocalDate(now, timezone) — UTC noon of eff. date.
// pushHour: 5 (silent) or 9 (non-silent).
// DST safety: anchors to UTC noon of the next calendar day, then shifts by the difference
// between local noon and pushHour. A ±1 h DST transition produces at most ±1 h error,
// which is well within the 30-minute cron window that triggers the check.
export function nextPushAtUtc(effectiveUtc, timezone, pushHour) {
  // Next calendar day in UTC (the Worker's effective date is stored as UTC-at-noon)
  const nextUtcNoon = new Date(Date.UTC(
    effectiveUtc.getUTCFullYear(),
    effectiveUtc.getUTCMonth(),
    effectiveUtc.getUTCDate() + 1,
    12, 0, 0
  ));
  const c = localComponents(nextUtcNoon, timezone);
  // local at UTC noon = c.hours → adjust by (pushHour - c.hours) to reach pushHour
  const utcH = 12 + (pushHour - c.hours);
  return new Date(Date.UTC(
    nextUtcNoon.getUTCFullYear(),
    nextUtcNoon.getUTCMonth(),
    nextUtcNoon.getUTCDate(),
    utcH, 0, 0
  ));
}

// Generate a random UUID v4 using Web Crypto.
export function uuid() {
  return crypto.randomUUID();
}
