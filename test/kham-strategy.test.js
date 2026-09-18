import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildKhamAttemptPlan,
  nextKhamRefreshDelay,
} from '../src/kham-strategy.js';

const primary = { date: '2027-02-28' };
const fallback = { date: '2027-02-27' };

test('single mode checks 2/28 before 2/27', () => {
  assert.deepEqual(buildKhamAttemptPlan('single', primary, fallback), [
    { product: primary, ticketCount: 1, adjacencyRequired: false },
    { product: fallback, ticketCount: 1, adjacencyRequired: false },
  ]);
});

test('two-adjacent mode searches both pairs before either single', () => {
  assert.deepEqual(buildKhamAttemptPlan('adjacent-two-then-one', primary, fallback), [
    { product: primary, ticketCount: 2, adjacencyRequired: true },
    { product: fallback, ticketCount: 2, adjacencyRequired: true },
    { product: primary, ticketCount: 1, adjacencyRequired: false },
    { product: fallback, ticketCount: 1, adjacencyRequired: false },
  ]);
});

test('invalid ticket mode is rejected', () => {
  assert.throws(() => buildKhamAttemptPlan('two-separated', primary, fallback), /Invalid Kham ticket mode/);
});

test('refresh delay stays between three and five seconds', () => {
  assert.equal(nextKhamRefreshDelay(() => 0), 3_000);
  assert.equal(nextKhamRefreshDelay(() => 0.5), 4_000);
  assert.equal(nextKhamRefreshDelay(() => 1), 5_000);
});
