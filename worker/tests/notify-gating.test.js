// Unit tests for the notification-invitation gating logic in app/main.js.
// Tested as a pure function of browser-state inputs so no DOM or Push API is needed.

import { describe, it, expect } from 'vitest';

// Mirrors isStandalone() in app/main.js.
function isStandalone(nav, mq) {
  if (nav && nav.standalone === true) return true;
  return !!(mq && mq.matches);
}

// Mirrors the invitation gating expression in app/main.js:
//   isStandalone() && Notification.permission === "default" && !notifyDismissed()
function shouldShowInvitation({ navigatorStandalone, matchMediaStandalone, permission, dismissed }) {
  const standalone = isStandalone(
    { standalone: navigatorStandalone },
    { matches: matchMediaStandalone }
  );
  return standalone && permission === "default" && !dismissed;
}

const BASE = {
  navigatorStandalone: false,
  matchMediaStandalone: false,
  permission: "default",
  dismissed: false
};

// ── isStandalone detection ──────────────────────────────────────────────────

describe('isStandalone detection', () => {
  it('iOS navigator.standalone=true → standalone', () => {
    expect(isStandalone({ standalone: true }, { matches: false })).toBe(true);
  });

  it('display-mode: standalone matchMedia → standalone', () => {
    expect(isStandalone({ standalone: false }, { matches: true })).toBe(true);
  });

  it('normal browser tab (both false) → not standalone', () => {
    expect(isStandalone({ standalone: false }, { matches: false })).toBe(false);
  });

  it('navigator.standalone undefined (non-iOS) + matchMedia false → not standalone', () => {
    expect(isStandalone({}, { matches: false })).toBe(false);
  });

  it('both iOS and matchMedia true → standalone', () => {
    expect(isStandalone({ standalone: true }, { matches: true })).toBe(true);
  });
});

// ── invitation gating ───────────────────────────────────────────────────────

describe('notification invitation gating', () => {
  it('normal browser tab (no standalone) → invitation hidden', () => {
    expect(shouldShowInvitation({ ...BASE })).toBe(false);
  });

  it('installed PWA via iOS standalone + permission default + not dismissed → invitation shown', () => {
    expect(shouldShowInvitation({ ...BASE, navigatorStandalone: true })).toBe(true);
  });

  it('installed PWA via matchMedia standalone + permission default + not dismissed → invitation shown', () => {
    expect(shouldShowInvitation({ ...BASE, matchMediaStandalone: true })).toBe(true);
  });

  it('standalone + permission granted → invitation hidden', () => {
    expect(shouldShowInvitation({ ...BASE, navigatorStandalone: true, permission: "granted" })).toBe(false);
  });

  it('standalone + permission denied → invitation hidden', () => {
    expect(shouldShowInvitation({ ...BASE, navigatorStandalone: true, permission: "denied" })).toBe(false);
  });

  it('standalone + permission default + previously dismissed → invitation hidden', () => {
    expect(shouldShowInvitation({ ...BASE, navigatorStandalone: true, dismissed: true })).toBe(false);
  });

  it('not standalone + permission default + not dismissed → invitation hidden (browser tab)', () => {
    expect(shouldShowInvitation({ ...BASE, navigatorStandalone: false, matchMediaStandalone: false })).toBe(false);
  });

  it('not standalone + permission denied → invitation hidden', () => {
    expect(shouldShowInvitation({ ...BASE, navigatorStandalone: false, permission: "denied" })).toBe(false);
  });

  it('not standalone + previously dismissed → invitation hidden', () => {
    expect(shouldShowInvitation({ ...BASE, navigatorStandalone: false, dismissed: true })).toBe(false);
  });
});
