import test from 'node:test';
import assert from 'node:assert/strict';

import { KhamController } from '../src/kham-controller.js';

test('Kham runtime ticket mode accepts only the two supported choices', () => {
  const controller = new KhamController('/tmp/kham-controller-test');

  assert.equal(
    controller.setTicketMode('adjacent-two-then-one').config.ticketMode,
    'adjacent-two-then-one',
  );
  assert.throws(() => controller.setTicketMode('two-separated'), /票數模式/);
  controller.state.running = true;
  assert.throws(() => controller.setTicketMode('single'), /執行中/);
});

test('Kham general sale refuses to retain a card prefix', () => {
  const controller = new KhamController('/tmp/kham-controller-test');
  assert.throws(() => controller.setCardPrefix('123456'), /一般販售模式/);
  assert.equal(controller.cardPrefix, null);
});

class FlowController extends KhamController {
  constructor(results, ticketMode = 'single') {
    super('/tmp/kham-controller-test');
    this.results = [...results];
    this.attempts = [];
    this.waits = 0;
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

  async waitBeforeNextAttempt() {
    this.waits += 1;
    return true;
  }
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
  assert.equal(controller.waits, 3);
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
