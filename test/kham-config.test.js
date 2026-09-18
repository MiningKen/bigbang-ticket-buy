import test from 'node:test';
import assert from 'node:assert/strict';

import { readKhamConfig } from '../src/kham-config.js';

test('Kham CTBC configuration defaults to the agreed two-date, one-ticket plan', () => {
  const config = readKhamConfig({}, '/tmp/kham-config-test');

  assert.equal(config.primary.date, '2027-02-28');
  assert.equal(config.fallback.date, '2027-02-27');
  assert.equal(config.ticketCount, 1);
  assert.equal(config.autoAdvance, true);
  assert.equal(config.wantVipBenefit, true);
});

test('Kham CTBC configuration never permits more than two tickets', () => {
  assert.throws(() => readKhamConfig({ KHAM_TICKET_COUNT: '3' }), /cannot exceed 2/);
});
