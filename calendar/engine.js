// calendar/engine.js
// Sacred calendar arithmetic and the 05:00 sacred-day boundary.
// Requires calendar/data.js to be loaded first (sets SacredCalendar.MONTHS etc.).
// Loaded as a plain script; extends the SacredCalendar namespace.
//
// THE SINGLE BOUNDARY FUNCTION IS SacredCalendar.getSacredDay(now).
// All callers that need "the current sacred date" must go through getSacredDay,
// not toSacredDate, so the 05:00 rule is applied exactly once, in one place.
(function () {
  "use strict";
  var ns = globalThis.SacredCalendar;
  var MONTHS   = ns.MONTHS;
  var ELEMENTS = ns.ELEMENTS;
  var FEASTS   = ns.FEASTS;
  var DAY_MS   = 86400000;

  // Extract local date/time components for a UTC instant in a given IANA timezone.
  // Returns { year, month (0-based), date, hours }.
  // Used only by the timezone-context code path (Worker / explicit-tz callers).
  function localComponents(utcMoment, timezone) {
    var parts = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false
    }).formatToParts(utcMoment).forEach(function(p) { parts[p.type] = p.value; });
    var h = parseInt(parts.hour, 10);
    if (h === 24) h = 0;   // some Intl implementations return '24' for midnight
    return {
      year:  parseInt(parts.year,  10),
      month: parseInt(parts.month, 10) - 1,
      date:  parseInt(parts.day,   10),
      hours: h
    };
  }

  // Convert a Gregorian local calendar day to a sacred date object.
  // 'date' must already be adjusted to the correct effective local day —
  // call getSacredDay() for the live date; call this directly only in tests
  // where you supply an already-correct noon-anchored date.
  //
  // Returns one of:
  //   { hiatus: true,  index }
  //   { hiatus: false, index, monthIndex, month, season, element, day, feast }
  //     where feast is { name, url? } | null
  ns.toSacredDate = function toSacredDate(date) {
    var y        = date.getFullYear();
    var t        = Date.UTC(y, date.getMonth(), date.getDate());
    var openYear = (t >= Date.UTC(y, 2, 21)) ? y : y - 1;
    var index    = Math.round((t - Date.UTC(openYear, 2, 21)) / DAY_MS);

    if (index >= 364) {
      return { hiatus: true, index: index };
    }

    var mi     = Math.floor(index / 28);
    var dd     = (index % 28) + 1;
    var season = MONTHS[mi][1];

    return {
      hiatus:     false,
      index:      index,
      monthIndex: mi,
      month:      MONTHS[mi][0],
      season:     season,
      element:    ELEMENTS[season],
      day:        dd,
      feast:      FEASTS[mi + ":" + dd] || null
    };
  };

  // Apply the 05:00 local sacred-day boundary to a given moment and return
  // the corresponding sacred date.
  //
  // Rule: between 00:00 and 04:59:59 local time the sacred day has not yet
  // changed; the effective date is the preceding local calendar day.
  // At 05:00 the new sacred day begins.
  ns.getSacredDay = function getSacredDay(now, timezone) {
    return ns.toSacredDate(ns.effectiveLocalDate(now, timezone));
  };

  // Format a Date as "d Month YYYY" using its local calendar day.
  ns.profaneDate = function profaneDate(date) {
    var months = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];
    return date.getDate() + " " + months[date.getMonth()] + " " + date.getFullYear();
  };

  // Compute the local Date used as the effective date for display
  // (what getSacredDay uses internally) — returned so callers can show it
  // as the civil date when appropriate.
  // If timezone is omitted: device-local behaviour (existing code path, unchanged).
  // If timezone is an IANA string: resolves local hour via Intl, applies the same
  // 05:00 rule, and returns a Date whose .getFullYear()/.getMonth()/.getDate()/.getDay()
  // reflect the effective local date in that timezone.
  // In a Cloudflare Worker (UTC runtime) the returned Date is UTC-anchored at noon,
  // so all .get*() accessors correctly return the effective local y/m/d/weekday.
  ns.effectiveLocalDate = function effectiveLocalDate(now, timezone) {
    if (timezone) {
      var c = localComponents(now, timezone);
      var y = c.year, mo = c.month, dt = c.date;
      if (c.hours < 5) {
        var prev = new Date(Date.UTC(y, mo, dt - 1, 12, 0, 0));
        y = prev.getUTCFullYear(); mo = prev.getUTCMonth(); dt = prev.getUTCDate();
      }
      return new Date(Date.UTC(y, mo, dt, 12, 0, 0));
    }
    var d = new Date(now);
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    return d;
  };

  // Parse an optional URL query-string override for development / testing.
  //   ?date=YYYY-MM-DD       — treated as local noon (no boundary ambiguity)
  //   ?datetime=YYYY-MM-DDTHH:MM — treated as local time (boundary tests)
  // Returns a Date, or null if the parameter is absent or unparseable.
  ns.parseTestDate = function parseTestDate() {
    if (typeof window === 'undefined' || !window.location) return null;
    var params = new URLSearchParams(window.location.search);

    var dt = params.get("datetime");
    if (dt) {
      var normalised = /T\d{2}:\d{2}$/.test(dt) ? dt + ":00" : dt;
      var d1 = new Date(normalised);
      return isNaN(d1.getTime()) ? null : d1;
    }

    var ds = params.get("date");
    if (ds) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds);
      if (!m) return null;
      var d2 = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
      return isNaN(d2.getTime()) ? null : d2;
    }

    return null;
  };
}());
