// Cloudflare Worker entry point.
// Fetch handler: subscribe / unsubscribe / timezone-update API.
// Scheduled handler: cron → enqueue root scan message.
// Queue handler: routes scan/deliver messages to their consumers.

import { handleScheduled }  from './scheduler.js';
import { handleScan }       from './scan-consumer.js';
import { handleDeliver }    from './deliver-consumer.js';
import { nextPushAtUtc }    from './util.js';

// Re-use the calendar namespace set up by scheduler.js's transitive imports.
const C = globalThis.SacredCalendar;

// ── Origin enforcement ────────────────────────────────────────────────────────
// Requests are accepted only from the Chapel PWA's exact production origin.
// This is enforced server-side; browser CORS is not relied upon.
const ALLOWED_ORIGIN = 'https://chapel-of-our-mother-god.github.io';

function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin === ALLOWED_ORIGIN ? origin : null;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export default {
  // ── Scheduled (cron) ──────────────────────────────────────────────────────
  async scheduled(_event, env, _ctx) {
    await handleScheduled(env);
  },

  // ── Queue consumer ────────────────────────────────────────────────────────
  async queue(batch, env, _ctx) {
    for (const msg of batch.messages) {
      const { type } = msg.body;
      try {
        if (type === 'scan') {
          await handleScan(msg.body, env);
          msg.ack();
        } else if (type === 'deliver') {
          await handleDeliver(msg.body, env, msg.attempts);
          msg.ack();
        } else {
          console.error('queue: unknown message type:', type);
          msg.ack();
        }
      } catch (err) {
        console.error('queue: error type=' + type + ':', err.message);
        msg.retry();
      }
    }
  },

  // ── HTTP fetch ────────────────────────────────────────────────────────────
  async fetch(request, env) {
    const origin = allowedOrigin(request);

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!origin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    }

    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case '/api/subscribe':       return await handleSubscribe(request, env, origin);
        case '/api/unsubscribe':     return await handleUnsubscribe(request, env, origin);
        case '/api/timezone-update': return await handleTimezone(request, env, origin);
        default:
          return jsonResponse({ error: 'Not found' }, 404, origin);
      }
    } catch (err) {
      console.error('fetch handler:', err);
      return jsonResponse({ error: 'Internal server error' }, 500, origin);
    }
  }
};

// ── Route handlers ─────────────────────────────────────────────────────────

async function handleSubscribe(request, env, origin) {
  const body = await parseBody(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400, origin);

  const { endpoint, p256dh, auth, timezone = 'UTC', silent_supported = false } = body;

  if (!isValidEndpoint(endpoint)) return jsonResponse({ error: 'Invalid endpoint' }, 400, origin);
  if (!p256dh || typeof p256dh !== 'string') return jsonResponse({ error: 'Missing p256dh' }, 400, origin);
  if (!auth   || typeof auth   !== 'string') return jsonResponse({ error: 'Missing auth'   }, 400, origin);
  if (!isValidTimezone(timezone))            return jsonResponse({ error: 'Invalid timezone' }, 400, origin);

  const now       = new Date();
  const eld       = C.effectiveLocalDate(now, timezone);
  const pushHour  = silent_supported ? 5 : 9;
  const nextPush  = nextPushAtUtc(eld, timezone, pushHour);

  // Upsert: if the endpoint already exists, update keys/timezone/schedule.
  const existing = await env.DB.prepare(
    'SELECT id FROM subscriptions WHERE endpoint = ?'
  ).bind(endpoint).first();

  if (existing) {
    await env.DB.prepare(
      'UPDATE subscriptions SET p256dh=?, auth=?, timezone=?, silent_supported=?, ' +
      'next_push_at_utc=? WHERE id=?'
    ).bind(p256dh, auth, timezone, silent_supported ? 1 : 0,
           nextPush.getTime(), existing.id).run();
    return jsonResponse({ ok: true, id: existing.id }, 200, origin);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO subscriptions (id, endpoint, p256dh, auth, timezone, silent_supported, ' +
    'next_push_at_utc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, endpoint, p256dh, auth, timezone, silent_supported ? 1 : 0,
         nextPush.getTime(), now.getTime()).run();

  return jsonResponse({ ok: true, id }, 201, origin);
}

async function handleUnsubscribe(request, env, origin) {
  const body = await parseBody(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400, origin);

  const { endpoint } = body;
  if (!endpoint) return jsonResponse({ error: 'Missing endpoint' }, 400, origin);

  await env.DB.prepare(
    'DELETE FROM subscriptions WHERE endpoint = ?'
  ).bind(endpoint).run();

  return jsonResponse({ ok: true }, 200, origin);
}

async function handleTimezone(request, env, origin) {
  const body = await parseBody(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400, origin);

  const { endpoint, timezone, silent_supported } = body;
  if (!endpoint)             return jsonResponse({ error: 'Missing endpoint' }, 400, origin);
  if (!isValidTimezone(timezone)) return jsonResponse({ error: 'Invalid timezone' }, 400, origin);

  const sub = await env.DB.prepare(
    'SELECT id, silent_supported FROM subscriptions WHERE endpoint = ?'
  ).bind(endpoint).first();
  if (!sub) return jsonResponse({ error: 'Subscription not found' }, 404, origin);

  // Use the supplied silent_supported if present; otherwise keep the stored value.
  const effectiveSilent = (silent_supported !== undefined && silent_supported !== null)
    ? !!silent_supported
    : !!sub.silent_supported;

  const now      = new Date();
  const eld      = C.effectiveLocalDate(now, timezone);
  const pushHour = effectiveSilent ? 5 : 9;
  const nextPush = nextPushAtUtc(eld, timezone, pushHour);

  await env.DB.prepare(
    'UPDATE subscriptions SET timezone=?, silent_supported=?, next_push_at_utc=? WHERE id=?'
  ).bind(timezone, effectiveSilent ? 1 : 0, nextPush.getTime(), sub.id).run();

  return jsonResponse({ ok: true }, 200, origin);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isValidEndpoint(ep) {
  if (typeof ep !== 'string') return false;
  try {
    const u = new URL(ep);
    return u.protocol === 'https:';
  } catch { return false; }
}

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch { return false; }
}
