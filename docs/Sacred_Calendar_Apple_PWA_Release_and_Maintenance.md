# Sacred Calendar — iPhone/iPad Web App
## Release and maintenance documentation

**Record date:** 25 September 2026  
**Last updated:** 26 September 2026 (lunar-symbol release; see section 10, "Release record — 26 September 2026")  
**Status:** Live PWA; one available iPhone/iPad tester reports that it works fine. This is encouraging feedback, **not** a claim that every device, notification scenario or offline scenario has been verified.  
**Document scope:** Apple-facing installable web app, its static hosting and Cloudflare notification backend. Android and Windows applications are separate products and are not changed by the procedures here.

## 1. Quick reference

| Item | Current arrangement |
|---|---|
| Public app | https://chapel-of-our-mother-god.github.io/Apple-Sacred-Calendar/ |
| GitHub repository | `Chapel-Of-Our-Mother-God/Apple-Sacred-Calendar` |
| Live PWA branch | `pwa-build` (GitHub Pages) |
| Other branch | `main` is the embeddable widget; **not** the live PWA |
| Latest documented repo commit | `03112b42067c5fd18b1e57473919dfaf4b3af29a` — `Fix lunar symbols in PWA display and notifications` |
| Worker source synchronization commit | `675f2c0` — `Sync production queue Worker source` |
| Picture implementation commit | `43f6630` — `Add Sacred Calendar web pictures` |
| PWA privacy-policy commit | `3836683` — `Add PWA privacy policy` |
| Service-worker cache version | `v8` (bumped from `v7`, which followed the PWA privacy-policy update, for the lunar-symbol update) |
| Static site host | GitHub Pages |
| Push backend | Cloudflare Worker + D1 + Queues (including dead-letter queue) |
| Worker deployment | Manual; pushing GitHub code does **not** deploy the Worker |
| Current documented production Worker version | `8f49ea0f-8c2b-4978-a336-c81bfcfc1587` (100% active when verified on 26 September 2026; it replaced `92b321dd-9166-4e98-9b04-44b49546c21d`, the version verified on 25 September 2026) |
| Working GitHub clone on development PC | `C:\Users\candr\Videos\Github\Apple-Sacred-Calendar` |
| Original non-Git queue-era copy | `C:\Users\candr\Videos\Claude Code\Apple-Sacred-Calendar` |

**Working-source rule:** Use the GitHub clone on `pwa-build` as the maintained source. The original queue-era Worker folder was used to reconstruct and verify production and is no longer the authoritative version-controlled working copy.

## 2. What users receive

The app is an installable web app for iPhone and iPad. Users open the public link in **Safari** and choose **Share → Add to Home Screen**. The Home Screen icon opens the Sacred Calendar.

The app displays the sacred date and relevant feast, lunar or Sunday text. On eligible days it also displays the daily picture as part of the app: **no separate picture button or tap is required**. A Chapel-linked feast takes precedence over the picture. Kala and the Hiatus have no picture.

Features include the sacred calendar, Chapel feast links, a 56-picture Main cycle, a separate 14-picture Moura cycle, optional web push notifications, offline caching of the app and picture assets once cached, and a dedicated PWA privacy page with a return link. iOS does not provide a continuously updating native Home Screen widget for this web app; the installed icon opens the PWA.

To replace an old installed copy, press and hold its Home Screen icon and choose **Remove App → Delete App**, then open the public link in Safari and add it to the Home Screen again. Reinstallation is a practical tester procedure, not a requirement for every ordinary web deployment. A cached version can take time to update through normal service-worker lifecycle rules.

## 3. Calendar and display invariants

- The sacred-day boundary is **05:00 local time**, not midnight.
- Regular dates, Moura, Kala and the Hiatus have distinct display rules. Do not make calendar logic dependent on the day the app was installed.
- Feast days have highest priority for display/notifications. Lower-priority lunar and Sunday material must not compete with a feast on the same sacred day.
- Canonical lunar text:
  - New Moon: `🌑 New moon: Hail to Our Mother!`
  - Day of Artemis: `🌒 Day of Artemis: Holy Lady, slay our false self.`
  - Full Moon: `🌕 Full Moon : Praise to Our Mother!`
  - Half Moon: `🌗 Half Moon Day Beloved Daughter, have Mercy on us.`
- Day of Artemis occurs once per lunar cycle, on the fifth day after New Moon.
- Half Moon Day occurs once per lunar cycle: take the midpoint between Full Moon and the following New Moon, find the sacred day owning that instant using the 05:00 boundary, then choose the nearest Monday by calendar-day count.
- Sunday reminder: `Sunday - Day of Our Divine Mother`, with the sacred date.

**Notification precedence for the PWA:** Feast > lunar observance > Sunday reminder. Do not add duplicate competing notifications on a feast day. The Windows application has a separate month-start summary rule; do not silently import it into the PWA.

## 4. Picture behavior — frozen rules

**Source collection:** 70 shared local master images: `Main` (56) and `Moura` (14), sourced originally from `C:\Users\candr\Videos\Claude Code\SacredCalendarPictures`. The PWA includes its own static copies at `pictures/Main/` and `pictures/Moura/`; GitHub Pages serves them and the service worker caches them. These are not fetched from a separate runtime picture service.

**Main cycle:** Advance through images 1–56 only on eligible Main-picture sacred days. A Chapel-link day consumes no picture position. Kala, the Hiatus and every Moura day consume no Main position. Resume after Moura at the next Main position and wrap from 56 to 1.

**Moura cycle:** Advance through images 1–14 only on eligible Moura-picture sacred days. Chapel-link days and Kala consume no position. Wrap from 14 to 1.

**Universal rules:** A feast with a Chapel URL uses the link instead of a picture. Selection is deterministic from sacred dates, regardless of install date. The web picture number on a date does **not** need to equal the Android or Windows picture number: do not rewrite native picture cycles merely for cross-platform number matching.

Relevant PWA implementation: `calendar/pictures.js`, `app/main.js`, `app/app.css`, `index.html`, static `pictures/` folders and `sw.js` precache. The picture implementation passed **21/21** reported tests when introduced.

## 5. Front-end repository and deployment

The maintained PWA is on `pwa-build`. Changes to the static app are committed and pushed to that branch; GitHub Pages serves the branch. The `main` branch contains a different, embeddable widget and should not be merged or repurposed for cosmetic tidiness.

The current documented frontend state includes the picture changes, PWA `privacy.html`, its link from the app and service-worker cache **v8**. The privacy update (cache v7) precached the privacy page; v8 was introduced with the lunar-symbol update. A Pages push and a Cloudflare Worker deployment are **different operations**.

For a future front-end release: inspect the current `pwa-build` status; isolate the requested change; run its relevant tests; review the file diff and secret exposure; update the service-worker cache/version when changed assets require it; commit and push only intended files; then check the live URL and a real Apple device. Do not assume that a successful Git push proves an updated service worker has activated on every installed phone.

The existing app privacy policy is `privacy.html` in `pwa-build`. The separate native-app privacy site remains for Android/Windows. Do not swap either product to the other product's policy.

## 6. Cloudflare push backend — production topology

The Worker source is version-controlled in the **same `pwa-build` repository** under `worker/`. The verified production source was copied in commit `675f2c0`, without deployment.

| Production component | Documented value |
|---|---|
| Worker | `sacred-calendar-notifications` |
| Worker cron | `*/5 * * * *` |
| D1 binding | `DB` → `chapel-sacred-calendar` |
| D1 database ID | `328b0634-0caf-41a8-a96b-1ab9985df67a` |
| Queue producer binding | `PUSH_QUEUE` → `sacred-calendar-push` |
| Queue consumer | Worker itself; batch size 1; timeout 0 ms; max retries 2; max concurrency 10; retry delay 0 |
| Dead-letter queue | `sacred-calendar-push-dlq` (no consumer, intentionally) |
| Handlers | `scheduled`, `queue`, `fetch` |
| Observability | Enabled; sampling 1; logs and invocation logs enabled; traces and logpush off at verification |
| VAPID | `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY` exist as Worker secrets; `VAPID_SUBJECT=https://mother-god.com` |

The scheduled handler checks whether subscriptions are due, obtains the `scan_state` lock and enqueues a scan message. Queue handlers process scan and delivery messages with acknowledgement/retry behavior. The old direct sender is retained as an **unused** `handleScheduledLegacy` function; it references imports that are no longer present. **Do not call or reactivate it.** Removal would be a separate source change, not release housekeeping.

Backend files added/changed in the production-source synchronization:

- Modified: `worker/wrangler.toml`, `worker/schema.sql`, `worker/src/index.js`, `worker/src/push.js`, `worker/src/scheduler.js`.
- Added: `worker/migration-queue.sql`, `worker/src/scan-consumer.js`, `worker/src/deliver-consumer.js`, `worker/src/vapid.js`, `worker/tests/queue-hardening.test.js`.

The Worker imports shared `calendar/data.js`, `calendar/engine.js` and `calendar/lunar.js` outside `worker/`. The deploy working directory and relative imports matter; do not lift the Worker folder into an unrelated directory without preserving the required shared files.

### Provenance and verification

Cloudflare reported 100% of the active deployment on version `92b321dd-9166-4e98-9b04-44b49546c21d`. A read-only fetch of its active module returned `index.js` of **47,923 bytes**. A local `wrangler deploy --dry-run` using Wrangler **3.114.17** generated the same 47,923-byte module, with matching SHA-256 and a raw byte-for-byte comparison. Both the original deploy and dry-run reported **46.80 KiB**, gzip **12.74 KiB**. Production bindings/configuration were checked against `wrangler.toml`. The source sync then copied only 10 intended files to GitHub; Worker tests reported **179/179 passed across 7 files**, and `pwa-build` was clean and synchronized after push.

These observations prove the executable active bundle matched the locally built queue-era Worker at verification time. Tests, SQL migrations, package manifests and TOML comments are not part of that executable bundle. The proof is a dated record, not a guarantee that future Cloudflare changes cannot occur.

The evidence in this subsection describes version `92b321dd-9166-4e98-9b04-44b49546c21d`, which was the active version on 25 September 2026. It was superseded by version `8f49ea0f-8c2b-4978-a336-c81bfcfc1587` on 26 September 2026 (see the 26 September 2026 release record in section 10); it is retained as the original production-verification record.

### Deployment safety

**A GitHub push does not deploy this Worker:** there is no GitHub Actions CI/deploy workflow in this repository at the documented commit. Deployment is manual through `wrangler deploy` from a correctly configured Worker folder. Do not deploy as a source-control tidying step; first inspect production, dependencies, intended changes, migration needs and rollback path. Keep VAPID keys in Cloudflare secrets, not Git. Never commit `.env`, `.dev.vars`, private keys, `node_modules`, `.wrangler`, downloaded production modules or temporary API outputs.

Queue/D1 creation and migration are infrastructure steps separate from copying files. In particular, **do not re-run the queue migration or seed `sent_log` blindly** on an existing production database.

## 7. Notification data and privacy facts

The calendar display itself does not require a user account or personal details. For opted-in push, the app/backend handles a push endpoint, `p256dh` public key, `auth` secret, timezone and `silent_supported`; these are stored in D1 `subscriptions` with an ID, next-send time and creation time. A push endpoint is a unique technical identifier, so do not describe notification data as anonymous.

The implementation also stores notification delivery history in `sent_log` and `delivery_events`; `scan_state` is transient coordination state. The documented implementation has **no automatic retention/cleanup job for historical sent/delivery rows**. Unsubscribe deletes the subscription if the request succeeds; a permanent push 404/410 deletes the subscription; transient failures are retried and exhausted deliveries do not automatically delete the subscription. Do not promise that deleting an installed PWA automatically erases all previously retained backend history.

Static hosting is via GitHub Pages; the backend runs on Cloudflare Workers, D1 and Queues; delivery passes through the platform/browser push service. Cloudflare observability is enabled. Review the actual policy and code together before changing collection, retention or external services. The privacy page does not promise a retention deadline that the code does not implement.

## 8. Release acceptance and tester checks

**Feedback received:** one available Apple tester says the app works fine. A second tester is not currently available. Record that accurately; do not label unperformed checks “passed.”

Suggested device checklist for the available tester or a future maintenance release:

- Open the public link in Safari, add it to the Home Screen, launch from the icon and check the sacred date around the 05:00 boundary when practical.
- Confirm the picture is visible on an eligible day and fits the iPhone/iPad screen. There is no separate picture control to tap.
- Open the built-in Privacy Policy and use its return link.
- Reopen the installed app after closing it; check date and picture display.
- After an online load has cached the needed assets, switch to Airplane Mode and check that the calendar and current picture load. Restore connectivity afterward.
- If notifications are enabled, check actual delivery over relevant days, especially precedence when a feast coincides with a lunar observance or Sunday. A single day without a due notification cannot validate scheduling.
- Report blank screens, old cached versions, incorrect sacred dates, broken Chapel links, missing pictures, unreadable layout or notification anomalies, along with device and iOS/iPadOS version.

An uninstall/reinstall can clear a tester's stale installed app, but **do not assume reinstall alone revokes a server-side push subscription or deletes delivery history**. Use the app's notification unsubscribe/disable flow where available.

## 9. Troubleshooting and change discipline

**Old version on device:** confirm GitHub Pages is serving `pwa-build`, inspect the currently served service worker/cache version, then check activation on the actual device. Only then consider an uninstall/reinstall for a small tester group.

**Picture missing:** distinguish a deliberate no-picture day (Chapel-link feast, Kala or Hiatus) from an asset/caching error. Check sacred date, picture eligibility, filename/path case and whether that image is in the SW precache. Do not alter the deterministic cycle because a single date has no image.

**Push not received:** first establish whether notifications are enabled and the user/device is eligible on that sacred day. Then check the precedence rule, subscription state/timezone, due time, scheduled Worker run, queue status, delivery event and push-provider response. Do not redeploy or modify D1 on a hunch.

**Worker change:** inspect/observe first; isolate one falsifiable issue; make the smallest code change; run focused and full tests; dry-run; compare intended config, migrations and artifacts; deploy only with explicit approval; verify production afterward. A build/test report alone does not prove actual deployment behavior.

**No-change housekeeping rule:** do not merge `main` into `pwa-build`, rewrite Android/Windows picture algorithms, reactivate the legacy direct sender, add auto-deploy CI, or alter privacy/retention promises just to make the repository look tidier.

## 10. Release record and open items

| Item | Recorded state at 25 Sep 2026 |
|---|---|
| Pictures | Implemented and committed; 21/21 picture tests reported passing when introduced |
| PWA privacy page | Committed; local PWA policy linked and precached |
| Service worker | Cache `v7` documented; device-specific activation should be checked when necessary |
| Queue Worker source | Committed to `pwa-build` at `675f2c0` |
| Worker production equivalence | Active fetched bundle and local dry-run bundle byte-identical at verification |
| Worker regression tests | 179/179 passed in 7 test files on identical source before sync |
| Git status after sync | Clean; HEAD and origin/pwa-build at `675f2c05488b703eea1162ff502ab11771f4a6ea` |
| Worker deploy during sync | None; Cloudflare resources unchanged |
| Apple tester feedback | One tester says it works fine; detailed offline/push scenarios not independently recorded as passed |

**Open only as needed:** capture the tester's device/iOS version if a bug emerges; check offline and push behavior on real hardware when convenient; update this record after any future production deployment or materially changed test result. No new coding work is required solely because the second tester is unavailable.

### Release record — 26 September 2026 (lunar symbols)

The lunar symbol `🕀` rendered incorrectly on phones. It was replaced in both the on-screen lunar text and the push notification text. The wording, calendar calculations, timing, precedence, pictures, privacy, subscriptions and queue infrastructure were not changed.

| Item | Recorded state at 26 Sep 2026 |
|---|---|
| Symbols replaced | New Moon 🌑, Day of Artemis 🌒, Full Moon 🌕, Half Moon Day 🌗 (defined once in `calendar/lunar.js`, shared by the app and the Worker) |
| Frontend commit | `03112b4` — `Fix lunar symbols in PWA display and notifications` (`calendar/lunar.js`, `sw.js`, `tests/tests.html`, `worker/tests/notify.test.js`, this document) |
| Service worker | `CACHE_NAME` changed from `sacred-calendar-v7` to `sacred-calendar-v8`; caching strategy, precache list and push handler unchanged |
| Frontend tests | 263/263 passed (`tests/tests.html`, run in a browser against a local server) |
| Worker tests | 179/179 passed across 7 test files (`npm ci` from the existing lockfile; dependencies and lockfiles unchanged) |
| GitHub Pages | Verified serving the updated `calendar/lunar.js` (new symbols, old symbol absent) and `sw.js` (`v8`), both matching the committed files |
| Worker dry-run | `wrangler deploy --dry-run` with Wrangler 3.114.17 from the GitHub clone's `worker/` folder (not the old queue-era folder) produced a 47,923-byte bundle; compared with the then-active production bundle, only the four lunar-symbol lines differed |
| Production Worker deployment | Version `8f49ea0f-8c2b-4978-a336-c81bfcfc1587`, deployment ID `ab71b05c-632e-459d-8390-ab8124a5360b`, created 26 September 2026 12:08:35 UTC; replaced `92b321dd-9166-4e98-9b04-44b49546c21d` |
| Post-deployment verification | New version verified 100% active; the active bundle contains all four new symbols (`\u{1F311}`, `\u{1F312}`, `\u{1F315}`, `\u{1F317}`) and none of the old symbol (`\u{1F540}`) |
| Configuration | Bindings (D1 `DB`, `PUSH_QUEUE`, VAPID secrets, `VAPID_SUBJECT`), cron `*/5 * * * *`, queue consumer settings, dead-letter queue and observability all unchanged from the 25 September verification; no D1, queue, secret or subscription changes |

**Not yet verified:**

- Actual delivery of a push notification carrying the new symbols has **not** been verified on a phone. The first real lunar-day notification received by a subscribed device will confirm it. A notification already queued when the Worker deployment completed could still have shown the old symbol.
- Activation of service-worker cache `v8` on the installed PWA has **not** been independently confirmed on a device.
