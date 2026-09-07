import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nextPollDelay,
  findBrowserExecutable,
  isAvailableApiStatus,
  parseBoolean,
  parsePrices,
  priceTextPattern,
  readConfig,
} from '../src/config.js';
import {
  findSessionByDate,
  normalizeSeatingMode,
  parseDateArgument,
  updateEnvValues,
  updateEnvSession,
} from '../src/sessions.js';

test('parsePrices accepts the documented comma-separated plain values', () => {
  assert.deepEqual(parsePrices('6800,5800,4800'), ['6800', '5800', '4800']);
});

test('priceTextPattern matches formatted prices without matching a larger number', () => {
  const pattern = priceTextPattern('6800');
  assert.match('全票 NT. 6,800', pattern);
  assert.doesNotMatch('全票 NT. 16,800', pattern);
});

test('parseBoolean recognizes affirmative values', () => {
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('0'), false);
  assert.equal(parseBoolean(undefined, true), true);
});

test('readConfig rejects an inverted poll interval', () => {
  assert.throws(
    () => readConfig({ POLL_MIN_MS: '25000', POLL_MAX_MS: '15000' }),
    /POLL_MAX_MS/,
  );
});

test('nextPollDelay stays inside the configured range', () => {
  const config = { pollMinMs: 100, pollMaxMs: 200 };
  assert.equal(nextPollDelay(config, () => 0), 100);
  assert.equal(nextPollDelay(config, () => 0.999), 200);
});

test('isAvailableApiStatus only accepts positive inventory states', () => {
  assert.equal(isAvailableApiStatus('onsale'), true);
  assert.equal(isAvailableApiStatus('available'), true);
  assert.equal(isAvailableApiStatus('unavailable'), false);
  assert.equal(isAvailableApiStatus('soldout'), false);
});

test('each supported date resolves to the correct internal session', () => {
  assert.equal(findSessionByDate('2026-10-09').internalSessionId, 's000002148');
  assert.equal(findSessionByDate('2026-10-10').internalSessionId, 's000002145');
  assert.equal(findSessionByDate('2026-10-11').internalSessionId, 's000002147');
  assert.equal(findSessionByDate('2026-10-12'), null);
});

test('parseDateArgument accepts both CLI forms', () => {
  assert.equal(parseDateArgument(['--date=2026-10-10']), '2026-10-10');
  assert.equal(parseDateArgument(['--date', '2026-10-11']), '2026-10-11');
  assert.equal(parseDateArgument([]), null);
});

test('updateEnvSession updates both date and API session atomically', () => {
  const result = updateEnvSession(
    'TARGET_DATE=2026-10-09\nINTERNAL_SESSION_ID=s000002148\nTICKET_COUNT=1\n',
    findSessionByDate('2026-10-11'),
  );
  assert.match(result, /^TARGET_DATE=2026-10-11$/m);
  assert.match(result, /^INTERNAL_SESSION_ID=s000002147$/m);
  assert.match(result, /^TICKET_COUNT=1$/m);
});

test('normalizeSeatingMode supports all three strategies and the legacy flag', () => {
  assert.equal(normalizeSeatingMode('adjacent-only'), 'adjacent-only');
  assert.equal(normalizeSeatingMode('adjacent-preferred'), 'adjacent-preferred');
  assert.equal(normalizeSeatingMode('any'), 'any');
  assert.equal(normalizeSeatingMode(undefined, true), 'any');
  assert.throws(() => normalizeSeatingMode('sometimes'), /SEATING_MODE/);
});

test('updateEnvValues persists ticket count and seating strategy', () => {
  const result = updateEnvValues('TICKET_COUNT=1\nSEATING_MODE=any\n', {
    TICKET_COUNT: 3,
    SEATING_MODE: 'adjacent-preferred',
  });
  assert.match(result, /^TICKET_COUNT=3$/m);
  assert.match(result, /^SEATING_MODE=adjacent-preferred$/m);
});

test('updateEnvValues does not add a leading blank line to a new file', () => {
  assert.equal(updateEnvValues('', { TICKET_COUNT: 2 }), 'TICKET_COUNT=2\n');
});

test('readConfig rejects ticket counts above the event limit', () => {
  assert.throws(() => readConfig({ TICKET_COUNT: '5' }), /cannot exceed 4/);
});

test('findBrowserExecutable prefers Chrome and falls back to Edge on Windows', () => {
  const env = {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
  };
  const edge = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.equal(findBrowserExecutable(env, 'win32', (path) => path === edge), edge);
});

test('findBrowserExecutable respects an explicit override', () => {
  assert.equal(
    findBrowserExecutable({ CHROME_PATH: 'D:\\Browser\\chrome.exe' }, 'win32', () => false),
    'D:\\Browser\\chrome.exe',
  );
});
