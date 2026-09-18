import test from 'node:test';
import assert from 'node:assert/strict';

import { KhamController } from '../src/kham-controller.js';

class FlowController extends KhamController {
  constructor(results) {
    super('/tmp/kham-controller-test');
    this.results = [...results];
    this.products = [];
    this.cardPrefix = '123456';
  }

  getConfig() {
    return {
      primary: { label: '2/28', date: '2027-02-28' },
      fallback: { label: '2/27', date: '2027-02-27' },
      saleStart: new Date(0),
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

  async runProduct(product) {
    this.products.push(product.date);
    return this.results.shift();
  }
}

test('Kham flow falls back to 2/27 when 2/28 has no actionable purchase option', async () => {
  const controller = new FlowController([
    { reason: 'no-purchase-option' },
    { reason: 'selected' },
  ]);

  await controller.start();

  assert.deepEqual(controller.products, ['2027-02-28', '2027-02-27']);
  assert.equal(controller.state.running, false);
});

test('Kham flow does not abandon 2/28 for a temporary queue timeout', async () => {
  const controller = new FlowController([{ reason: 'timed-out' }]);

  await controller.start();

  assert.deepEqual(controller.products, ['2027-02-28']);
});
