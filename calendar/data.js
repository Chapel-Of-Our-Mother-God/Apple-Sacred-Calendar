// calendar/data.js
// Canonical sacred calendar data — the single source of truth.
// Loaded as a plain script; attaches to the SacredCalendar namespace so
// production, tests, and preview all share exactly this one copy.
(function () {
  "use strict";
  var ns = globalThis.SacredCalendar = globalThis.SacredCalendar || {};

  ns.MONTHS = [
    ["Culverine", "Spring"],
    ["Maia",      "Spring"],
    ["Hera",      "Spring"],
    ["Rosea",     "Summer"],
    ["Kerea",     "Summer"],
    ["Vaskaras",  "Summer"],
    ["Abolan",    "Autumn"],
    ["Vois",      "Autumn"],
    ["Werdë","Autumn"],
    ["Astraea",   "Winter"],
    ["Herthë","Winter"],
    ["Brighë","Winter"],
    ["Moura",     "Moura"]
  ];

  ns.ELEMENTS = {
    "Spring": "Water",
    "Summer": "Fire",
    "Autumn": "Earth",
    "Winter": "Air",
    "Moura":  "Aether"
  };

  // Feast entries keyed "monthIndex:day" (month 0–12, day 1–28).
  // Each entry: { name, url? }
  // url is present only where the date reference document supplies one.
  // Do not add, invent or remove URLs.
  ns.FEASTS = {
    "0:1":   { name: "Eastre",                     url: "https://www.mother-god.com/easter.html" },
    "0:5":   { name: "Lady Day",                   url: "https://www.mother-god.com/princess-mp3.html" },
    "1:1":   { name: "Maia’s Day",            url: "https://www.mother-god.com/day-of-maia.html" },
    "1:14":  { name: "Exaltation Day",             url: "https://www.mother-god.com/may-day.html" },
    "2:1":   { name: "Sai Rayanna Day",            url: "https://www.mother-god.com/warrior-queen.html" },
    "2:10":  { name: "Florimaia" },
    "3:9":   { name: "Rosa Mundi",                 url: "https://www.mother-god.com/rosa-mundi.html" },
    "4:22":  { name: "Chelanya",                   url: "https://www.mother-god.com/golden-festival.html" },
    "5:16":  { name: "Werde’s Day",           url: "https://www.mother-god.com/day-of-werde.html" },
    "6:17":  { name: "Cuivanya",                   url: "https://www.mother-god.com/autumnal-equinox.html" },
    "8:1":   { name: "Tamala — first day",    url: "https://www.mother-god.com/feast-of-the-dead.html" },
    "8:2":   { name: "Tamala — second day",  notifiable: false },
    "8:3":   { name: "Tamala — third day",   notifiable: false },
    "8:23":  { name: "Feast of Artemis" },
    "9:1":   { name: "Advent",                     url: "https://www.mother-god.com/winter-festivals.html" },
    "9:11":  { name: "The Conception",             url: "https://www.mother-god.com/feast-of-the-conception.html" },
    "9:28":  { name: "Nativity Day",               url: "https://www.mother-god.com/Nativity.html" },
    "10:1":  { name: "Nativity — 2",   notifiable: false },
    "10:2":  { name: "Nativity — 3",   notifiable: false },
    "10:3":  { name: "Nativity — 4",   notifiable: false },
    "10:4":  { name: "Nativity — 5",   notifiable: false },
    "10:5":  { name: "Nativity — 6",   notifiable: false },
    "10:6":  { name: "The Day of Sai Herthe",      url: "https://www.mother-god.com/day-of-sai-herthe.html" },
    "10:7":  { name: "Nativity — 8",   notifiable: false },
    "10:8":  { name: "Nativity — 9",   notifiable: false },
    "10:9":  { name: "Nativity — 10",  notifiable: false },
    "10:10": { name: "Nativity — 11",  notifiable: false },
    "10:11": { name: "Duodecima - 12", notifiable: false },
    "10:12": { name: "The Epiphany",               url: "https://www.mother-god.com/feast-of-the-epiphany.html" },
    "11:11": { name: "Luciad",                     url: "https://www.mother-god.com/feast-of-lights.html" },
    "11:28": { name: "Moura Eve",                  url: "https://www.mother-god.com/moura.html" },
    "12:1":  { name: "Moura Day",  url: "https://www.mother-god.com/moura.html", happy: false },
    "12:14": { name: "Med Moura", url: "https://www.mother-god.com/moura.html" },
    "12:28": { name: "Kala",      url: "https://www.mother-god.com/moura.html", happy: false }
  };

  // Feast for The Hiatus — not in FEASTS (the engine returns { hiatus:true } for Hiatus days).
  // Used only by notification logic; never shown by the existing browser rendering code.
  // First Hiatus day only (index 364); second day in a leap year is suppressed by the caller.
  ns.HIATUS_FEAST = { name: "The Hiatus", url: "https://www.mother-god.com/easter-hymn.html", notifiable: true, happy: false };
}());
