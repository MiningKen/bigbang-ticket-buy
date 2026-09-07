import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inferLoginStatus,
  inferPollMode,
  preferencesToEnv,
  validatePreferences,
} from '../src/preferences.js';

test('validatePreferences accepts a complete control-panel selection', () => {
  const result = validatePreferences({
    targetDate: '2026-10-10',
    ticketCount: 3,
    seatingMode: 'adjacent-preferred',
    preferredPrices: '9430, 8380,6980',
    autoAdvance: true,
    pollMode: 'fast',
  });
  assert.equal(result.session.internalSessionId, 's000002145');
  assert.equal(result.ticketCount, 3);
  assert.deepEqual(result.preferredPrices, ['9430', '8380', '6980']);
  assert.equal(result.pollMode, 'fast');
});

test('validatePreferences rejects missing prices and invalid counts', () => {
  assert.throws(
    () => validatePreferences({ targetDate: '2026-10-09', ticketCount: 0, seatingMode: 'any' }),
    /1–4/,
  );
  assert.throws(
    () => validatePreferences({ targetDate: '2026-10-09', ticketCount: 1, seatingMode: 'any' }),
    /票價/,
  );
});

test('preferencesToEnv keeps terms and auto advance coupled', () => {
  const preferences = validatePreferences({
    targetDate: '2026-10-11',
    ticketCount: 2,
    seatingMode: 'adjacent-only',
    preferredPrices: '8880',
    autoAdvance: false,
    pollMode: 'conservative',
  });
  assert.deepEqual(preferencesToEnv(preferences), {
    TARGET_DATE: '2026-10-11',
    INTERNAL_SESSION_ID: 's000002147',
    TICKET_COUNT: 2,
    PREFERRED_PRICES: '8880',
    SEATING_MODE: 'adjacent-only',
    ACCEPT_TERMS: false,
    AUTO_ADVANCE: false,
    POLL_MIN_MS: 15000,
    POLL_MAX_MS: 25000,
  });
});

test('poll presets map existing intervals back to the control panel', () => {
  assert.equal(inferPollMode(5_000, 8_000), 'fast');
  assert.equal(inferPollMode(10_000, 15_000), 'balanced');
  assert.equal(inferPollMode(15_000, 25_000), 'conservative');
  assert.equal(inferPollMode(7_000, 9_000), 'custom');
});

test('inferLoginStatus distinguishes logged-in and logged-out headers', () => {
  assert.equal(inferLoginStatus('0988***030 登出 中文'), 'logged-in');
  assert.equal(inferLoginStatus('會員登入 中文'), 'logged-out');
  assert.equal(inferLoginStatus('載入中'), 'unknown');
});
