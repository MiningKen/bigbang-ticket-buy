import test from 'node:test';
import assert from 'node:assert/strict';

import { KhamController } from '../src/kham-controller.js';

class FlowController extends KhamController {
  constructor(results, ticketMode = 'single') {
    super('/tmp/kham-controller-test');
    this.results = [...results];
    this.attempts = [];
    this.ticketMode = ticketMode;
  }

  getConfig() {
    return {
      primary: { label: '2/28', date: '2027-02-28' },
      fallback: { label: '2/27', date: '2027-02-27' },
      saleStart: new Date(0),
      saleMode: 'general-sale',
      ticketMode: this.ticketMode,
    };
  }

  async ensureBrowser() {
    this.page = { bringToFront: async () => {} };
    return this.page;
  }

  async refreshLoginStatus() {
    this.state.loginStatus = 'logged-in';
    return this.state.loginStatus;
  }

  async waitForSaleStart() {}

  async runAttempt(attempt) {
    this.attempts.push([attempt.product.date, attempt.ticketCount]);
    return this.results.shift();
  }

  async waitBeforeNextAttempt() {}
}

test('Kham controller repeats 2/28 and 2/27 until selected', async () => {
  const controller = new FlowController([
    { reason: 'unavailable' },
    { reason: 'unavailable' },
    { reason: 'unavailable' },
    { reason: 'selected' },
  ]);

  await controller.start();

  assert.deepEqual(controller.attempts, [
    ['2027-02-28', 1],
    ['2027-02-27', 1],
    ['2027-02-28', 1],
    ['2027-02-27', 1],
  ]);
  assert.equal(controller.state.running, false);
});

test('Kham two-ticket mode completes both pair attempts before a single', async () => {
  const controller = new FlowController([
    { reason: 'adjacent-unavailable' },
    { reason: 'adjacent-unavailable' },
    { reason: 'selected' },
  ], 'adjacent-two-then-one');

  await controller.start();

  assert.deepEqual(controller.attempts, [
    ['2027-02-28', 2],
    ['2027-02-27', 2],
    ['2027-02-28', 1],
  ]);
});

test('Kham controller stops cycling when an attempt is blocked', async () => {
  const controller = new FlowController([{ reason: 'blocked' }]);

  await controller.start();

  assert.deepEqual(controller.attempts, [['2027-02-28', 1]]);
  assert.equal(controller.state.phase, 'blocked');
});
