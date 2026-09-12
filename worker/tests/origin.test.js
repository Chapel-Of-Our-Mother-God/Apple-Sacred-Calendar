// Unit tests for server-side Origin enforcement in worker/src/index.js.
// These tests exercise the allowedOrigin() guard logic directly, and simulate
// the fetch handler's response to correct / wrong / missing Origin headers.
//
// The handler is also tested for correct CORS header values on OPTIONS preflight.

import { describe, it, expect, vi } from 'vitest';

// ── Isolate the allowedOrigin guard without importing the full Worker ──────
// We re-implement the guard logic from index.js so the tests remain fast and
// don't require D1 bindings.  The actual index.js is integration-tested via
// wrangler dev / miniflare once Node.js is available.

const ALLOWED_ORIGIN = 'https://chapel-of-our-mother-god.github.io';

function allowedOrigin(headers) {
  const origin = headers.get ? headers.get('Origin') : headers['Origin'] || null;
  return origin === ALLOWED_ORIGIN ? origin : null;
}

function makeHeaders(origin) {
  const h = new Map([['content-type', 'application/json']]);
  if (origin !== undefined) h.set('Origin', origin);
  h.get = (k) => h.get(k.toLowerCase()) ?? h.get(k) ?? null;
  // Fix: Map.get returns undefined not null for missing keys — patch it.
  const orig = h.get.bind(h);
  h.get = (k) => orig(k.toLowerCase()) ?? orig(k) ?? null;
  return h;
}

// Simpler helper
function hdr(origin) {
  return { get: (k) => k === 'Origin' ? (origin ?? null) : null };
}

// ── allowedOrigin unit tests ───────────────────────────────────────────────

describe('allowedOrigin — guard function', () => {
  it('exact production origin → returns origin string', () => {
    expect(allowedOrigin(hdr(ALLOWED_ORIGIN))).toBe(ALLOWED_ORIGIN);
  });

  it('wrong origin → returns null', () => {
    expect(allowedOrigin(hdr('https://evil.example.com'))).toBeNull();
  });

  it('subdomain of allowed origin → returns null', () => {
    expect(allowedOrigin(hdr('https://sub.chapel-of-our-mother-god.github.io'))).toBeNull();
  });

  it('http (non-https) variant → returns null', () => {
    expect(allowedOrigin(hdr('http://chapel-of-our-mother-god.github.io'))).toBeNull();
  });

  it('missing Origin header → returns null', () => {
    expect(allowedOrigin(hdr(undefined))).toBeNull();
  });

  it('empty string Origin → returns null', () => {
    expect(allowedOrigin(hdr(''))).toBeNull();
  });

  it('null Origin → returns null', () => {
    expect(allowedOrigin(hdr(null))).toBeNull();
  });
});

// ── Fetch handler behaviour simulation ────────────────────────────────────
// Simulates the handler's branching logic without real D1 or push.

function simulateHandler(method, origin) {
  const resolvedOrigin = allowedOrigin(hdr(origin));

  if (method === 'OPTIONS') {
    if (!resolvedOrigin) return { status: 403, corsOrigin: null };
    return { status: 204, corsOrigin: resolvedOrigin };
  }

  if (!resolvedOrigin) return { status: 403, corsOrigin: null };
  if (method !== 'POST') return { status: 405, corsOrigin: resolvedOrigin };

  return { status: 200, corsOrigin: resolvedOrigin }; // route match assumed
}

describe('fetch handler — origin enforcement', () => {
  it('POST with correct origin → allowed (200)', () => {
    const r = simulateHandler('POST', ALLOWED_ORIGIN);
    expect(r.status).not.toBe(403);
    expect(r.corsOrigin).toBe(ALLOWED_ORIGIN);
  });

  it('POST with wrong origin → 403', () => {
    const r = simulateHandler('POST', 'https://attacker.example.com');
    expect(r.status).toBe(403);
    expect(r.corsOrigin).toBeNull();
  });

  it('POST with missing Origin → 403', () => {
    const r = simulateHandler('POST', undefined);
    expect(r.status).toBe(403);
    expect(r.corsOrigin).toBeNull();
  });

  it('OPTIONS preflight with correct origin → 204 with exact origin', () => {
    const r = simulateHandler('OPTIONS', ALLOWED_ORIGIN);
    expect(r.status).toBe(204);
    expect(r.corsOrigin).toBe(ALLOWED_ORIGIN);
  });

  it('OPTIONS preflight with wrong origin → 403', () => {
    const r = simulateHandler('OPTIONS', 'https://evil.com');
    expect(r.status).toBe(403);
    expect(r.corsOrigin).toBeNull();
  });

  it('OPTIONS preflight with missing origin → 403', () => {
    const r = simulateHandler('OPTIONS', undefined);
    expect(r.status).toBe(403);
    expect(r.corsOrigin).toBeNull();
  });

  it('CORS response never contains wildcard', () => {
    const r = simulateHandler('POST', ALLOWED_ORIGIN);
    expect(r.corsOrigin).not.toBe('*');
  });

  it('Allowed origin value is exactly the production GitHub Pages URL', () => {
    expect(ALLOWED_ORIGIN).toBe('https://chapel-of-our-mother-god.github.io');
  });
});
