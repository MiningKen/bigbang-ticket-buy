import test from 'node:test';
import assert from 'node:assert/strict';

import { readKhamConfig } from '../src/kham-config.js';

test('Kham configuration defaults to the September 22 general sale', () => {
  const config = readKhamConfig({}, '/tmp/kham-config-test');

  assert.equal(config.primary.date, '2027-02-28');
  assert.equal(config.fallback.date, '2027-02-27');
  assert.equal(config.saleMode, 'general-sale');
  assert.equal(config.saleStart.toISOString(), '2026-09-22T02:00:00.000Z');
  assert.equal(config.ticketMode, 'single');
  assert.equal(config.ticketCount, 1);
  assert.equal(config.autoAdvance, true);
  assert.equal(config.wantVipBenefit, true);
});

test('Kham configuration accepts the adjacent-pair fallback mode', () => {
  const config = readKhamConfig({ KHAM_TICKET_MODE: 'adjacent-two-then-one' });
  assert.equal(config.ticketMode, 'adjacent-two-then-one');
  assert.equal(config.ticketCount, 2);
});

test('Kham configuration rejects unknown sale and ticket modes', () => {
  assert.throws(() => readKhamConfig({ KHAM_SALE_MODE: 'vip' }), /KHAM_SALE_MODE/);
  assert.throws(() => readKhamConfig({ KHAM_TICKET_MODE: 'two-separated' }), /KHAM_TICKET_MODE/);
});

test('Kham CTBC configuration never permits more than two tickets', () => {
  assert.throws(() => readKhamConfig({ KHAM_TICKET_COUNT: '3' }), /cannot exceed 2/);
});
