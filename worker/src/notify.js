// Notification priority and canonical text generation.
// Priority: FEAST > MONTH_START > LUNAR > SUNDAY > null
//
// Imports the three shared calendar files as side effects; they attach to
// globalThis.SacredCalendar, which is then aliased as C.

import '../../calendar/data.js';
import '../../calendar/engine.js';
import '../../calendar/lunar.js';

const C = globalThis.SacredCalendar;

const SUNDAY_BODY = 'Sunday - Day of Our Divine Mother';

// Returns a notification descriptor for nowUtc in the given IANA timezone, or
// null when no notification should be sent today.
// Descriptor: { title, body, url, type }  (url may be null)
export function computeNotification(nowUtc, timezone) {
  const eld = C.effectiveLocalDate(nowUtc, timezone);
  const sd  = C.toSacredDate(eld);

  // ── 1. Hiatus ──────────────────────────────────────────────────────────────
  if (sd.hiatus) {
    // Only the first Hiatus day (index 364) is notifiable; a second day in a
    // leap year (index 365) is suppressed here.
    if (sd.index === 364 && C.HIATUS_FEAST.notifiable) {
      return {
        title: C.HIATUS_FEAST.name,
        body:  'Pray for the World.',
        url:   C.HIATUS_FEAST.url || null,
        type:  'feast'
      };
    }
    return null;
  }

  // ── 2. Feast ───────────────────────────────────────────────────────────────
  if (sd.feast && sd.feast.notifiable !== false) {
    const feast = sd.feast;
    const body  = feast.happy === false
      ? 'Pray for the World.'
      : `Happy ${feast.name}!`;
    return { title: feast.name, body, url: feast.url || null, type: 'feast' };
  }

  // ── 3. Month start ─────────────────────────────────────────────────────────
  if (sd.day === 1) {
    const feasts = notifiableFeastsInMonth(sd.monthIndex);
    // Per the Android spec: if no feasts in the month, no notification.
    if (feasts.length === 0) return null;
    const body = feasts.map(f => `Day ${f.day}: ${f.name}`).join('\n');
    return { title: `${sd.month} begins`, body, url: null, type: 'month-start' };
  }

  // ── 4. Lunar ───────────────────────────────────────────────────────────────
  const lunar = C.getLunarObservance(nowUtc, timezone);
  if (lunar.type !== null) {
    return { title: 'Sacred Calendar', body: lunar.text, url: null, type: 'lunar' };
  }

  // ── 5. Sunday ──────────────────────────────────────────────────────────────
  // eld.getDay() works because in a UTC runtime the UTC-at-noon Date returned
  // by effectiveLocalDate() has .getDay() === local day-of-week.
  if (eld.getDay() === 0) {
    return { title: sd.day + ' ' + sd.month, body: SUNDAY_BODY, url: null, type: 'sunday' };
  }

  return null;
}

// List notifiable feasts (notifiable !== false) in a sacred month by index.
function notifiableFeastsInMonth(monthIndex) {
  const out = [];
  for (let day = 1; day <= 28; day++) {
    const feast = C.FEASTS[`${monthIndex}:${day}`];
    if (feast && feast.notifiable !== false) {
      out.push({ day, name: feast.name });
    }
  }
  return out;
}
