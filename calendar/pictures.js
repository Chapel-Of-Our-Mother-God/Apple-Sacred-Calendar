// calendar/pictures.js
// Sacred picture-sequence selection — canonical eligibility-counting algorithm.
//
// TWO independent sequences:
//
//   MAIN   56 images.
//          Anchor: Culverine 1, 2026 (21 March 2026).
//          A day advances the Main counter only if it is eligible:
//            - not Hiatus
//            - not a Moura day (monthIndex === 12)
//            - no Chapel URL feast
//          Eastre (anchor day, has Chapel URL) is ineligible → Main 1 appears on
//          Culverine 2, 2026 (the first eligible day after the anchor).
//          Main pauses throughout Moura; resumes at the next unused position after.
//          Chapel-URL feast days and Kala consume no Main position.
//          index = ((eligibleMainCount − 1) % 56) + 1
//
//   MOURA  14 images, used only during Moura (monthIndex === 12).
//          A Moura day advances the Moura counter only if it is eligible:
//            - no Chapel URL feast
//          Kala (Moura day 28, URL) is ineligible → consumes no Moura position.
//          Moura Day 1 (URL) is ineligible → Moura 1 appears on the first eligible Moura day.
//          Counting starts fresh from Moura Day 1 of the current sacred year's Moura period.
//          index = ((eligibleMouraCount − 1) % 14) + 1
//
//   GLOBAL rule: if today has a Chapel feast URL, return null.
//                If today is Hiatus, return null.
//                Neither case advances any sequence counter.
//
// Requires calendar/data.js and calendar/engine.js to be loaded first.
(function () {
  "use strict";
  var ns = globalThis.SacredCalendar;
  var DAY_MS      = 86400000;
  var ANCHOR      = Date.UTC(2026, 2, 21);   // Culverine 1, 2026 — inclusive lower bound
  var MAIN_COUNT  = 56;
  var MOURA_COUNT = 14;

  // Exact filename table — do not normalise filenames.
  // Indices 13 and 49 have two spaces; 16 and 21 carry an 'a' suffix; 36 is lowercase 'd'.
  var MAIN_FILES = [
    "",              // 0 — unused; table is 1-based
    "Day 1.jpg",
    "Day 2.jpg",
    "Day 3.jpg",
    "Day 4.jpg",
    "Day 5.jpg",
    "Day 6.jpg",
    "Day 7.jpg",
    "Day 8.jpg",
    "Day 9.jpg",
    "Day 10.jpg",
    "Day 11.jpg",
    "Day 12.jpg",
    "Day  13.jpg",   // two spaces
    "Day 14.jpg",
    "Day 15.jpg",
    "Day 16a.jpg",   // a suffix
    "Day 17.jpg",
    "Day 18.jpg",
    "Day 19.jpg",
    "Day 20.jpg",
    "Day 21a.jpg",   // a suffix
    "Day 22.jpg",
    "Day 23.jpg",
    "Day 24.jpg",
    "Day 25.jpg",
    "Day 26.jpg",
    "Day 27.jpg",
    "Day 28.jpg",
    "Day 29.jpg",
    "Day 30.jpg",
    "Day 31.jpg",
    "Day 32.jpg",
    "Day 33.jpg",
    "Day 34.jpg",
    "Day 35.jpg",
    "day 36.jpg",    // lowercase d
    "Day 37.jpg",
    "Day 38.jpg",
    "Day 39.jpg",
    "Day 40.jpg",
    "Day 41.jpg",
    "Day 42.jpg",
    "Day 43.jpg",
    "Day 44.jpg",
    "Day 45.jpg",
    "Day 46.jpg",
    "Day 47.jpg",
    "Day 48.jpg",
    "Day  49.jpg",   // two spaces
    "Day 50.jpg",
    "Day 51.jpg",
    "Day 52.jpg",
    "Day 53.jpg",
    "Day 54.jpg",
    "Day 55.jpg",
    "Day 56.jpg"
  ];

  var MOURA_FILES = [
    "",              // 0 — unused; table is 1-based
    "Moura 1.jpg",
    "Moura 2.jpg",
    "Moura 3.jpg",
    "Moura 4.jpg",
    "Moura 5.jpg",
    "Moura 6.jpg",
    "Moura 7.jpg",
    "Moura 8.jpg",
    "Moura 9.jpg",
    "Moura 10.jpg",
    "Moura 11.jpg",
    "Moura 12.jpg",
    "Moura 13.jpg",
    "Moura 14.jpg"
  ];

  // True iff a sacred-date object represents an eligible Main-picture day:
  // ordinary (not Moura, not Hiatus), no Chapel URL.
  function isEligibleMain(sd) {
    if (sd.hiatus) return false;
    if (sd.monthIndex === 12) return false;
    if (sd.feast && sd.feast.url) return false;
    return true;
  }

  // True iff a sacred-date object represents an eligible Moura-picture day:
  // must be a Moura day (monthIndex === 12), no Chapel URL.
  function isEligibleMoura(sd) {
    if (sd.monthIndex !== 12) return false;
    if (sd.feast && sd.feast.url) return false;
    return true;
  }

  // Convert a UTC midnight timestamp to a local Date whose getFullYear/Month/Date
  // match the UTC year/month/date, suitable for passing to toSacredDate.
  function utcToLocal(t) {
    var d = new Date(t);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  }

  // Count eligible Main-picture days in [ANCHOR, throughT] inclusive.
  function countEligibleMain(throughT) {
    var count = 0;
    for (var t = ANCHOR; t <= throughT; t += DAY_MS) {
      if (isEligibleMain(ns.toSacredDate(utcToLocal(t)))) count++;
    }
    return count;
  }

  // Count eligible Moura-picture days in [moura1T, throughT] inclusive,
  // where moura1T is the UTC midnight timestamp of Moura Day 1 this year.
  function countEligibleMoura(moura1T, throughT) {
    var count = 0;
    for (var t = moura1T; t <= throughT; t += DAY_MS) {
      if (isEligibleMoura(ns.toSacredDate(utcToLocal(t)))) count++;
    }
    return count;
  }

  // Returns a relative picture URL string, or null.
  // null means no picture today: before anchor, Hiatus, or any Chapel-URL feast day.
  // Callers pass the same 'now' (Date) used for the rest of the display; the
  // 05:00 boundary is applied internally via effectiveLocalDate.
  ns.getPicture = function getPicture(now) {
    var eff = ns.effectiveLocalDate(now);
    var t   = Date.UTC(eff.getFullYear(), eff.getMonth(), eff.getDate());

    // Before anchor — no picture
    if (t < ANCHOR) return null;

    var sd = ns.toSacredDate(eff);

    // Hiatus — no picture, no position consumed
    if (sd.hiatus) return null;

    // Chapel URL — no picture, no position consumed
    if (sd.feast && sd.feast.url) return null;

    // Moura sequence
    if (sd.monthIndex === 12) {
      // Moura Day 1 timestamp for this year's Moura period
      var moura1T = t - (sd.day - 1) * DAY_MS;
      var count   = countEligibleMoura(moura1T, t);
      var mi      = ((count - 1) % MOURA_COUNT) + 1;
      return "pictures/Moura/" + MOURA_FILES[mi];
    }

    // Main sequence
    var mainCount = countEligibleMain(t);
    var idx       = ((mainCount - 1) % MAIN_COUNT) + 1;
    return "pictures/Main/" + MAIN_FILES[idx];
  };
}());
