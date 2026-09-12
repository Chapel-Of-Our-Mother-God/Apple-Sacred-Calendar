// app/main.js
// Application entry point — wires the SacredCalendar engine to the DOM,
// schedules the 05:00 daily re-render, and registers the service worker.
// Requires calendar/data.js and calendar/engine.js to be loaded first.
(function () {
  "use strict";
  var C = window.SacredCalendar;

  // ── DOM refs ──────────────────────────────────────────────────────
  var elCard    = document.getElementById("cal-card");
  var elMonth   = document.getElementById("cal-month");
  var elDay     = document.getElementById("cal-day");
  var elSeason  = document.getElementById("cal-season");
  var elFeast   = document.getElementById("cal-feast");
  var elLink    = document.getElementById("cal-feast-link");
  var elProfane = document.getElementById("cal-profane");

  // ── Render ────────────────────────────────────────────────────────
  function render(now) {
    var sd = C.getSacredDay(now);

    if (sd.hiatus) {
      elMonth.textContent  = "The Hiatus";
      elDay.textContent    = "—";
      elDay.className      = "cal-day cal-day--text";
      elSeason.textContent = "";
      elFeast.textContent  = "The Day that Has No Date";
      elLink.hidden        = true;
      elCard.classList.add("cal-card--no-civil");
      return;
    }

    elDay.className = "cal-day";

    elMonth.textContent  = sd.month;
    elDay.textContent    = sd.day;
    elSeason.textContent = sd.season + " · " + sd.element;

    // Feast (priority) → Lunar observance → nothing
    if (sd.feast) {
      elFeast.textContent = sd.feast.name;
      if (sd.feast.url) {
        elLink.textContent = "Read about " + sd.feast.name;
        elLink.href        = sd.feast.url;
        elLink.hidden      = false;
      } else {
        elLink.hidden = true;
      }
    } else {
      var lo = C.getLunarObservance(now);
      elFeast.textContent = lo.text || "";
      elLink.hidden       = true;
    }

    // Civil date — suppressed during Moura (and Hiatus, handled above)
    if (sd.monthIndex === 12) {
      elCard.classList.add("cal-card--no-civil");
    } else {
      elCard.classList.remove("cal-card--no-civil");
      elProfane.textContent = C.profaneDate(C.effectiveLocalDate(now));
    }
  }

  // ── Scheduling ────────────────────────────────────────────────────
  // Fires at 05:00:05 local time each day.
  function scheduleNextRender() {
    var now  = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0, 5);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(function () {
      render(new Date());
      scheduleNextRender();
    }, next - now);
  }

  // ── Web Push constants (fill in after deploying the Worker) ──────────────
  // Generate a VAPID key pair (requires Node.js): npx web-push generate-vapid-keys
  // Then store as Worker secrets: wrangler secret put VAPID_PUBLIC_KEY  (and VAPID_PRIVATE_KEY)
  // Paste the base64url public key below.
  var VAPID_PUBLIC_KEY = "BKOvUaVaQHYnEsWCE0GCoDlcksdgSPMELZWzey8yBwlzjm7EOM7iB2_9uiNOw0DTqgUERU7LxcE97TzPbIq55Kg";
  // Your deployed Worker URL, e.g. "https://sacred-calendar-notifications.example.workers.dev"
  var WORKER_URL       = "https://sacred-calendar-notifications.chapel-sacred-calendar.workers.dev";

  function urlBase64ToUint8Array(b64) {
    var padding = "=".repeat((4 - b64.length % 4) % 4);
    var base64  = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  var NOTIFY_DISMISSED_KEY = "cal-notify-dismissed";
  var NOTIFY_TZ_KEY        = "cal-notify-tz";
  var NOTIFY_SILENT_KEY    = "cal-notify-silent";

  function notifyDismissed() {
    try { return !!localStorage.getItem(NOTIFY_DISMISSED_KEY); } catch (_) { return false; }
  }

  function setNotifyDismissed() {
    try { localStorage.setItem(NOTIFY_DISMISSED_KEY, "1"); } catch (_) {}
  }

  function getStoredTz() {
    try { return localStorage.getItem(NOTIFY_TZ_KEY) || null; } catch (_) { return null; }
  }

  function setStoredTz(tz) {
    try { localStorage.setItem(NOTIFY_TZ_KEY, tz); } catch (_) {}
  }

  function getStoredSilent() {
    try {
      var v = localStorage.getItem(NOTIFY_SILENT_KEY);
      return v === null ? null : (v === "1");
    } catch (_) { return null; }
  }

  function setStoredSilent(val) {
    try { localStorage.setItem(NOTIFY_SILENT_KEY, val ? "1" : "0"); } catch (_) {}
  }

  // True when the app is running as an installed standalone PWA, not a browser tab.
  // iOS Safari sets navigator.standalone; Chrome/Android uses the display-mode media query.
  function isStandalone() {
    if (navigator.standalone === true) return true;
    return window.matchMedia('(display-mode: standalone)').matches;
  }

  // On every launch with an active subscription: silently sync timezone and
  // silent_supported to the Worker if either value has changed since subscribe time.
  function checkTimezoneUpdate(sub) {
    var currentTz     = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
    var currentSilent = ("silent" in Notification.prototype);
    var storedTz      = getStoredTz();
    var storedSilent  = getStoredSilent();

    // No change — nothing to do.
    if (currentTz === storedTz && storedSilent !== null && currentSilent === storedSilent) return;

    fetch(WORKER_URL + "/api/timezone-update", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        endpoint:         sub.endpoint,
        timezone:         currentTz,
        silent_supported: currentSilent
      })
    }).then(function (res) {
      if (res.ok) {
        setStoredTz(currentTz);
        setStoredSilent(currentSilent);
      }
    }).catch(function () {});
  }

  function initNotifications(swReg) {
    var elNotify  = document.getElementById("cal-notify");
    var elEnable  = document.getElementById("cal-notify-enable");
    var elDismiss = document.getElementById("cal-notify-dismiss");
    if (!elNotify || !elEnable || !elDismiss) return;
    if (!("PushManager" in window)) return;
    // Skip until deployment-time placeholders are filled in.
    if (VAPID_PUBLIC_KEY === "REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY") return;
    if (WORKER_URL       === "REPLACE_WITH_YOUR_WORKER_URL")        return;

    swReg.pushManager.getSubscription().then(function (sub) {
      if (sub) {
        // Already subscribed — show status only, no dismiss option.
        elEnable.textContent   = "Notifications on";
        elEnable.dataset.state = "on";
        elDismiss.hidden       = true;
        elNotify.hidden        = false;
        checkTimezoneUpdate(sub);
      } else if (isStandalone() && Notification.permission === "default" && !notifyDismissed()) {
        elNotify.hidden = false;
      }
    }).catch(function () {});

    // ── "Enable notifications" ────────────────────────────────────────
    elEnable.addEventListener("click", function () {
      if (elEnable.dataset.state === "on") {
        // Tap on "Notifications on" → unsubscribe.
        swReg.pushManager.getSubscription().then(function (sub) {
          if (!sub) return Promise.resolve();
          var endpoint = sub.endpoint;
          return sub.unsubscribe().then(function () {
            return fetch(WORKER_URL + "/api/unsubscribe", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ endpoint: endpoint })
            });
          });
        }).then(function () {
          elEnable.textContent   = "Enable notifications";
          elEnable.dataset.state = "off";
          elDismiss.hidden       = false;
        }).catch(function () {
          elEnable.textContent   = "Enable notifications";
          elEnable.dataset.state = "off";
          elDismiss.hidden       = false;
        });
        return;
      }

      Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") {
          setNotifyDismissed();
          elNotify.hidden = true;
          return;
        }
        var timezone = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
        var silent   = ("silent" in Notification.prototype);
        swReg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        }).then(function (sub) {
          var json = sub.toJSON();
          return fetch(WORKER_URL + "/api/subscribe", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              endpoint:         json.endpoint,
              p256dh:           json.keys.p256dh,
              auth:             json.keys.auth,
              timezone:         timezone,
              silent_supported: silent
            })
          });
        }).then(function () {
          setStoredTz(timezone);
          setStoredSilent(silent);
          elEnable.textContent   = "Notifications on";
          elEnable.dataset.state = "on";
          elDismiss.hidden       = true;
        }).catch(function () {
          elEnable.textContent   = "Enable notifications";
          elEnable.dataset.state = "off";
        });
      });
    });

    // ── "Not now" ─────────────────────────────────────────────────────
    elDismiss.addEventListener("click", function () {
      setNotifyDismissed();
      elNotify.hidden = true;
    });
  }

  // ── Service-worker registration ───────────────────────────────────
  function registerSW() {
    if ("serviceWorker" in navigator) {
      // "sw.js" resolves against the page URL (index.html), mapping to
      // /Apple-Sacred-Calendar/sw.js on GitHub Pages.
      navigator.serviceWorker.register("sw.js")
        .catch(function () { /* silently ignore on localhost / file:// */ });
      // Notification opt-in: requires an active SW, so wait for .ready
      navigator.serviceWorker.ready
        .then(function (reg) { initNotifications(reg); })
        .catch(function () {});
    }
  }

  // ── Start ─────────────────────────────────────────────────────────
  var testDate = C.parseTestDate();
  if (testDate) {
    render(testDate);   // test mode: render once, no scheduling
  } else {
    render(new Date());
    scheduleNextRender();
    registerSW();
  }
}());
