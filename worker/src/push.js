// Web Push wrapper.
// Uses @block65/webcrypto-web-push v2.0.0 (Web Crypto API only — no nodejs_compat).
//
// Return values:
//   { ok: true }        — push service accepted the notification (200/201)
//   { gone: true }      — subscription expired (410/404); caller should delete it
//   { transient: true } — retryable failure (429/5xx/network); caller should
//                         rollback the idempotency reservation and let cron retry

import { buildPushPayload } from '@block65/webcrypto-web-push';

export async function sendPushNotification(sub, notification, vapid) {
  const data = JSON.stringify({
    title:  notification.title,
    body:   notification.body,
    url:    notification.url,
    tag:    notification.tag,
    silent: notification.silent
  });

  const subscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth:   sub.auth
    }
  };

  const message = {
    data,
    options: { ttl: 86400 }
  };

  const payload = await buildPushPayload(message, subscription, vapid);

  let res;
  try {
    res = await fetch(sub.endpoint, payload);
  } catch (_) {
    // Network-level error (DNS, TCP, TLS) — treat as transient.
    return { transient: true };
  }

  if (res.status === 410 || res.status === 404) return { gone: true };
  if (res.status === 201 || res.status === 200) return { ok: true };
  if (res.status === 429 || res.status >= 500)  return { transient: true };

  // Unexpected 4xx (not 404/410) — not retryable; treat as a permanent error.
  throw new Error(`Push service returned unexpected status ${res.status} for ${sub.endpoint}`);
}
