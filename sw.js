// sw.js — Service worker for the Chapel Sacred Calendar PWA.
// Uses a cache-first strategy for all listed app assets so the calendar
// works fully offline after the first install.
// Bump CACHE_NAME on every release to force old cached files to be replaced.

const CACHE_NAME = "sacred-calendar-v7";

const ASSETS = [
  "./",
  "./index.html",
  "./privacy.html",
  "./manifest.json",
  "./app/app.css",
  "./app/main.js",
  "./calendar/data.js",
  "./calendar/engine.js",
  "./calendar/lunar.js",
  "./calendar/pictures.js",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  // Sacred picture assets — precached in full (70 files, ~6.9 MB total)
  "./pictures/Main/Day 1.jpg",
  "./pictures/Main/Day 2.jpg",
  "./pictures/Main/Day 3.jpg",
  "./pictures/Main/Day 4.jpg",
  "./pictures/Main/Day 5.jpg",
  "./pictures/Main/Day 6.jpg",
  "./pictures/Main/Day 7.jpg",
  "./pictures/Main/Day 8.jpg",
  "./pictures/Main/Day 9.jpg",
  "./pictures/Main/Day 10.jpg",
  "./pictures/Main/Day 11.jpg",
  "./pictures/Main/Day 12.jpg",
  "./pictures/Main/Day  13.jpg",
  "./pictures/Main/Day 14.jpg",
  "./pictures/Main/Day 15.jpg",
  "./pictures/Main/Day 16a.jpg",
  "./pictures/Main/Day 17.jpg",
  "./pictures/Main/Day 18.jpg",
  "./pictures/Main/Day 19.jpg",
  "./pictures/Main/Day 20.jpg",
  "./pictures/Main/Day 21a.jpg",
  "./pictures/Main/Day 22.jpg",
  "./pictures/Main/Day 23.jpg",
  "./pictures/Main/Day 24.jpg",
  "./pictures/Main/Day 25.jpg",
  "./pictures/Main/Day 26.jpg",
  "./pictures/Main/Day 27.jpg",
  "./pictures/Main/Day 28.jpg",
  "./pictures/Main/Day 29.jpg",
  "./pictures/Main/Day 30.jpg",
  "./pictures/Main/Day 31.jpg",
  "./pictures/Main/Day 32.jpg",
  "./pictures/Main/Day 33.jpg",
  "./pictures/Main/Day 34.jpg",
  "./pictures/Main/Day 35.jpg",
  "./pictures/Main/day 36.jpg",
  "./pictures/Main/Day 37.jpg",
  "./pictures/Main/Day 38.jpg",
  "./pictures/Main/Day 39.jpg",
  "./pictures/Main/Day 40.jpg",
  "./pictures/Main/Day 41.jpg",
  "./pictures/Main/Day 42.jpg",
  "./pictures/Main/Day 43.jpg",
  "./pictures/Main/Day 44.jpg",
  "./pictures/Main/Day 45.jpg",
  "./pictures/Main/Day 46.jpg",
  "./pictures/Main/Day 47.jpg",
  "./pictures/Main/Day 48.jpg",
  "./pictures/Main/Day  49.jpg",
  "./pictures/Main/Day 50.jpg",
  "./pictures/Main/Day 51.jpg",
  "./pictures/Main/Day 52.jpg",
  "./pictures/Main/Day 53.jpg",
  "./pictures/Main/Day 54.jpg",
  "./pictures/Main/Day 55.jpg",
  "./pictures/Main/Day 56.jpg",
  "./pictures/Moura/Moura 1.jpg",
  "./pictures/Moura/Moura 2.jpg",
  "./pictures/Moura/Moura 3.jpg",
  "./pictures/Moura/Moura 4.jpg",
  "./pictures/Moura/Moura 5.jpg",
  "./pictures/Moura/Moura 6.jpg",
  "./pictures/Moura/Moura 7.jpg",
  "./pictures/Moura/Moura 8.jpg",
  "./pictures/Moura/Moura 9.jpg",
  "./pictures/Moura/Moura 10.jpg",
  "./pictures/Moura/Moura 11.jpg",
  "./pictures/Moura/Moura 12.jpg",
  "./pictures/Moura/Moura 13.jpg",
  "./pictures/Moura/Moura 14.jpg"
];

// Install: pre-cache all app assets.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  // Take over immediately — don't wait for old SW to finish.
  self.skipWaiting();
});

// Activate: delete any caches from previous versions.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Push: display the notification sent by the Cloudflare Worker ─────────────
self.addEventListener("push", event => {
  let payload;
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const title   = payload.title || "Sacred Calendar";
  const options = {
    body:   payload.body  || "",
    icon:   "./icons/icon-192.png",
    badge:  "./icons/icon-192.png",
    data:   { url: payload.url || null },
    silent: payload.silent === true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open the feast page or focus the app ─────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url === target && "focus" in c) return c.focus();
      }
      return clients.openWindow(target);
    })
  );
});

// ── Fetch: serve from cache first; fall back to network for anything not cached.
// External Chapel feast pages (mother-god.com) are never cached here —
// they require connectivity and may change independently of the app.
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Only intercept same-origin requests (GitHub Pages origin).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached ?? fetch(event.request);
    })
  );
});
