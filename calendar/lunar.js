// calendar/lunar.js
// Lunar observance engine for the Chapel Sacred Calendar.
// Algorithm: Jean Meeus, "Astronomical Algorithms" 2nd ed., Chapter 49.
// Requires calendar/data.js and calendar/engine.js to be loaded first.
// Loaded as a plain script; extends the SacredCalendar namespace.
//
// PUBLIC API
//   SacredCalendar.getLunarObservance(now)
//     Returns { type, text } where type is one of:
//       'new-moon' | 'artemis' | 'full-moon' | 'half-moon' | null
//     and text is the exact canonical string, or null.
//     Call AFTER getSacredDay() has determined there is no feast; feast
//     priority is the caller's responsibility (see main.js).
//
// INTERNAL API (exposed for tests only)
//   SacredCalendar._lunar.truePhaseJD(k, phase)
//   SacredCalendar._lunar.jdToDate(jd)
//   SacredCalendar._lunar.kForDate(utcDate)
//   SacredCalendar._lunar.sacredLocalDay(utcMoment)  -- applies 05:00 rule
(function () {
  "use strict";
  var ns = globalThis.SacredCalendar;
  var DEG = Math.PI / 180;

  // ── Julian Day utilities ──────────────────────────────────────────────────

  // Approximate ΔT (TT − UTC) in seconds for a Julian Day in TT.
  // Piecewise — no expiry date; continues to produce finite values beyond 2150.
  // 2005–2050: Meeus §10 polynomial.
  // 2050–2150: IERS piecewise parabola blended toward secular term.
  // 2150+:     long-range secular parabola (Earth rotation slowing only).
  // Future ΔT is inherently uncertain; this models the expected trend,
  // not a precise prediction.
  function deltaT(jd) {
    var y = 2000 + (jd - 2451545.0) / 365.25;
    var t = y - 2000;
    if (y < 2050) {
      return 62.92 + 0.32217 * t + 0.005589 * t * t;
    }
    var u = (y - 1820) / 100;
    if (y < 2150) {
      return -20 + 32 * u * u - 0.5628 * (2150 - y);
    }
    return -20 + 32 * u * u;
  }

  // Convert any Julian Day Number to a JavaScript Date (UTC).  Meeus §7.
  // Pass a JD already in UTC (i.e. subtract ΔT first for TT-based JDE values).
  function jdToDate(jd) {
    var z = Math.floor(jd + 0.5);
    var f = jd + 0.5 - z;
    var A;
    if (z < 2299161) {
      A = z;
    } else {
      var alpha = Math.floor((z - 1867216.25) / 36524.25);
      A = z + 1 + alpha - Math.floor(alpha / 4);
    }
    var B   = A + 1524;
    var C   = Math.floor((B - 122.1) / 365.25);
    var D   = Math.floor(365.25 * C);
    var E   = Math.floor((B - D) / 30.6001);
    var day = B - D - Math.floor(30.6001 * E);
    var mo  = (E < 14) ? E - 1 : E - 13;
    var yr  = (mo > 2) ? C - 4716 : C - 4715;
    var th  = f * 24;
    var h   = Math.floor(th);
    var tm  = (th - h) * 60;
    var m   = Math.floor(tm);
    var ts  = (tm - m) * 60;
    var s   = Math.floor(ts);
    var ms  = Math.round((ts - s) * 1000);
    return new Date(Date.UTC(yr, mo - 1, day, h, m, s, ms));
  }

  // Meeus §49 — true Julian Day of lunar phase nearest to lunation k.
  // phase: 0 = New Moon, 0.25 = First Quarter, 0.5 = Full Moon, 0.75 = Last Quarter.
  function truePhaseJD(k, phase) {
    var kp = k + phase;
    var T  = kp / 1236.85;
    var T2 = T * T, T3 = T2 * T, T4 = T3 * T;

    var JDE = 2451550.09766
            + 29.530588861  * kp
            + 0.00015437    * T2
            - 0.000000150   * T3
            + 0.00000000073 * T4;

    var E  = 1 - 0.002516 * T - 0.0000074 * T2;
    var E2 = E * E;

    // Normalise angle in degrees to [0,360) then convert to radians
    function r(x) { return ((x % 360) + 360) % 360 * DEG; }

    var M  = r(2.5534     + 29.10535670   * kp - 0.0000014   * T2 - 0.00000011   * T3);
    var Mp = r(201.5643   + 385.81693528  * kp + 0.0107582   * T2 + 0.00001238   * T3 - 0.000000058 * T4);
    var F  = r(160.7108   + 390.67050284  * kp - 0.0016118   * T2 - 0.00000227   * T3 + 0.000000011 * T4);
    var Om = r(124.7746   -   1.56375588  * kp + 0.0020672   * T2 + 0.00000215   * T3);

    // Planetary arguments (Meeus Table 49.f)
    var A1  = r(299.77 +   0.107408 * kp - 0.009173 * T2);
    var A2  = r(251.88 +   0.016321 * kp);
    var A3  = r(251.83 +  26.651886 * kp);
    var A4  = r(349.42 +  36.412478 * kp);
    var A5  = r( 84.66 +  18.206239 * kp);
    var A6  = r(141.74 +  53.303771 * kp);
    var A7  = r(207.14 +   2.453732 * kp);
    var A8  = r(154.84 +   7.306860 * kp);
    var A9  = r( 34.52 +  27.261239 * kp);
    var A10 = r(207.19 +   0.121824 * kp);
    var A11 = r(291.34 +   1.844379 * kp);
    var A12 = r(161.72 +  24.198154 * kp);
    var A13 = r(239.56 +  25.513099 * kp);
    var A14 = r(331.55 +   3.592518 * kp);

    var S = Math.sin, C2 = Math.cos;
    var corr;

    if (phase === 0 || phase === 0.5) {
      // New Moon / Full Moon — Meeus Table 49.a
      corr = -0.40720          * S(Mp)
           + 0.17241 * E      * S(M)
           + 0.01608          * S(2*Mp)
           + 0.01039          * S(2*F)
           + 0.00739 * E      * S(Mp - M)
           - 0.00514 * E      * S(Mp + M)
           + 0.00208 * E2     * S(2*M)
           - 0.00111          * S(Mp - 2*F)
           - 0.00057          * S(Mp + 2*F)
           + 0.00056 * E      * S(2*Mp + M)
           - 0.00042          * S(3*Mp)
           + 0.00042 * E      * S(M + 2*F)
           + 0.00038 * E      * S(M - 2*F)
           - 0.00024 * E      * S(2*Mp - M)
           - 0.00017          * S(Om)
           - 0.00007          * S(Mp + 2*M)
           + 0.00004          * S(2*Mp - 2*F)
           + 0.00004          * S(3*M)
           + 0.00003          * S(Mp + M - 2*F)
           + 0.00003          * S(2*Mp + 2*F)
           - 0.00003          * S(Mp + M + 2*F)
           + 0.00003          * S(Mp - M + 2*F)
           - 0.00002          * S(Mp - M - 2*F)
           - 0.00002          * S(3*Mp + M)
           + 0.00002          * S(4*Mp);
    } else {
      // First / Last Quarter — Meeus Table 49.c
      corr = -0.62801          * S(Mp)
           + 0.17172 * E      * S(M)
           - 0.01183 * E      * S(Mp + M)
           + 0.00862          * S(2*Mp)
           + 0.00804          * S(2*F)
           + 0.00454 * E      * S(Mp - M)
           + 0.00204 * E2     * S(2*M)
           - 0.00180          * S(Mp - 2*F)
           - 0.00070          * S(Mp + 2*F)
           - 0.00040          * S(3*Mp)
           - 0.00034 * E      * S(2*Mp - M)
           + 0.00032 * E      * S(M + 2*F)
           + 0.00032 * E      * S(M - 2*F)
           - 0.00028 * E2     * S(Mp + 2*M)
           + 0.00027 * E      * S(2*Mp + M)
           - 0.00017          * S(Om)
           - 0.00005          * S(Mp - M - 2*F)
           + 0.00004          * S(2*Mp + 2*F)
           - 0.00004          * S(Mp + M + 2*F)
           + 0.00004          * S(Mp - 2*M)
           + 0.00003          * S(Mp + M - 2*F)
           + 0.00003          * S(3*M)
           + 0.00002          * S(2*Mp - 2*F)
           + 0.00002          * S(Mp - M + 2*F)
           - 0.00002          * S(3*Mp + M);
      // W term (different sign for FQ vs LQ) — Meeus §49
      var W = 0.00306
            - 0.00038 * E * C2(M)
            + 0.00026      * C2(Mp)
            - 0.00002      * C2(Mp - M)
            + 0.00002      * C2(Mp + M)
            + 0.00002      * C2(2*F);
      corr += (phase === 0.25) ? W : -W;
    }

    // Additional planetary corrections — Meeus Table 49.e
    var add = 0.000325 * S(A1)  + 0.000165 * S(A2)  + 0.000164 * S(A3)
            + 0.000126 * S(A4)  + 0.000110 * S(A5)  + 0.000062 * S(A6)
            + 0.000060 * S(A7)  + 0.000056 * S(A8)  + 0.000047 * S(A9)
            + 0.000042 * S(A10) + 0.000040 * S(A11) + 0.000037 * S(A12)
            + 0.000035 * S(A13) + 0.000023 * S(A14);

    return JDE + corr + add;
  }

  // Approximate lunation index k for a given UTC Date.
  // k=0 is the New Moon of January 6, 2000 (Meeus epoch).
  function kForDate(utcDate) {
    var y = utcDate.getUTCFullYear()
          + (utcDate.getUTCMonth() + utcDate.getUTCDate() / 31) / 12;
    return Math.floor((y - 2000) * 12.3685);
  }

  // ── 05:00 sacred-day boundary ─────────────────────────────────────────────

  // Apply the sacred-day 05:00 local boundary to a UTC moment.
  // Delegates to the shared ns.effectiveLocalDate so the 05:00 rule lives
  // in exactly one place. Optional timezone passed through unchanged.
  function sacredLocalDay(utcMoment, timezone) {
    return ns.effectiveLocalDate(utcMoment, timezone);
  }

  // Compare two Dates by local calendar day only (y/m/d).
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth()    === b.getMonth()
        && a.getDate()     === b.getDate();
  }

  // ── Phase event list ──────────────────────────────────────────────────────

  // Return an array of {type:'nm'|'fm', utc:Date, sacred:Date} sorted by utc,
  // covering a ±3-lunation window around the local calendar day of `localNow`.
  function phaseEvents(localNow, timezone) {
    var utcApprox = new Date(Date.UTC(
      localNow.getFullYear(), localNow.getMonth(), localNow.getDate(), 12));
    var k0 = kForDate(utcApprox);
    var ev = [];
    for (var k = k0 - 3; k <= k0 + 3; k++) {
      [0, 0.5].forEach(function(ph) {
        var jdTT  = truePhaseJD(k, ph);           // JDE in Terrestrial Time
        var jdUtc = jdTT - deltaT(jdTT) / 86400;  // convert TT → UTC
        var utc   = jdToDate(jdUtc);
        ev.push({ type: ph === 0 ? 'nm' : 'fm', utc: utc, sacred: sacredLocalDay(utc, timezone) });
      });
    }
    ev.sort(function(a, b) { return a.utc - b.utc; });
    return ev;
  }

  // ── Half Moon Day helper ──────────────────────────────────────────────────

  // Days-of-week (0=Sun … 6=Sat) → delta in calendar days to nearest Monday.
  // Mon=0, Tue=-1, Wed=-2, Thu=-3 (preceding Monday is nearer/equal);
  // Fri=+3, Sat=+2, Sun=+1 (following Monday is nearer).
  // Thu and Fri are both 3 calendar days from Monday; the table routes them
  // consistently: Thu → preceding Monday, Fri → following Monday.
  var MON_DELTA = [1, 0, -1, -2, -3, 3, 2]; // Sun Mon Tue Wed Thu Fri Sat

  // Given the UTC instant of the FM→NM midpoint, return the local-calendar
  // Date of the Half Moon Day Monday.
  //
  // Implementation of the canonical rule — no representative time invented:
  //   Step 1. Call the production effectiveLocalDate() on the midpoint to find
  //           its owning sacred date (the shared 05:00 rule, not civil midnight).
  //   Step 2. Count whole calendar days to the nearest Monday using MON_DELTA.
  //   Step 3. Return that Monday at local noon (noon is the standard date marker
  //           throughout this codebase; sameDay() only reads y/m/d fields).
  function nearestMonday(midUtc, timezone) {
    var eld   = ns.effectiveLocalDate(midUtc, timezone);  // shared 05:00 boundary
    var delta = MON_DELTA[eld.getDay()];
    return new Date(eld.getFullYear(), eld.getMonth(), eld.getDate() + delta, 12, 0, 0);
  }

  // ── Main public function ──────────────────────────────────────────────────

  ns.getLunarObservance = function getLunarObservance(now, timezone) {
    var eld = ns.effectiveLocalDate(now, timezone); // shared 05:00 boundary

    var ev = phaseEvents(eld, timezone);

    // 1. New Moon — phase event falls on the effective sacred day
    for (var i = 0; i < ev.length; i++) {
      if (ev[i].type === 'nm' && sameDay(ev[i].sacred, eld)) {
        return { type: 'new-moon',
                 text: '🌑 New moon: Hail to Our Mother!' };
      }
    }

    // 2. Full Moon
    for (var i = 0; i < ev.length; i++) {
      if (ev[i].type === 'fm' && sameDay(ev[i].sacred, eld)) {
        return { type: 'full-moon',
                 text: '🌕 Full Moon : Praise to Our Mother!' };
      }
    }

    // 3. Day of Artemis — 5 local calendar days after the New Moon sacred day
    for (var i = 0; i < ev.length; i++) {
      if (ev[i].type === 'nm') {
        var nmDay = ev[i].sacred;
        var art   = new Date(nmDay.getFullYear(), nmDay.getMonth(), nmDay.getDate() + 5, 12, 0, 0);
        if (sameDay(art, eld)) {
          return { type: 'artemis',
                   text: '🌒 Day of Artemis: Holy Lady, slay our false self.' };
        }
      }
    }

    // 4. Half Moon Day — one per lunation: nearest Monday to the FM→NM midpoint.
    // The canonical rule is Full Moon → Half Moon Day → New Moon (that order).
    // Only FM→NM pairs are used; NM→FM intervals are not Half Moon Day intervals.
    for (var i = 0; i < ev.length - 1; i++) {
      if (ev[i].type === 'fm' && ev[i+1].type === 'nm') {
        var mid = new Date((ev[i].utc.getTime() + ev[i+1].utc.getTime()) / 2);
        var mon = nearestMonday(mid, timezone);
        if (sameDay(mon, eld)) {
          return { type: 'half-moon',
                   text: '🌗 Half Moon Day Beloved Daughter, have Mercy on us.' };
        }
      }
    }

    return { type: null, text: null };
  };

  // Expose internals for the test suite only
  ns._lunar = {
    truePhaseJD:      truePhaseJD,
    jdToDate:         jdToDate,
    deltaT:           deltaT,
    kForDate:         kForDate,
    sacredLocalDay:   sacredLocalDay,
    phaseEvents:      phaseEvents,
    nearestMonday: nearestMonday
  };
}());
