import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyKhamPage,
  clickBestKhamPurchaseOption,
  fillKhamCardPrefix,
  normalizeKhamCardPrefix,
  priceFromKhamText,
  rankKhamOffers,
  submitKhamCardValidation,
} from '../src/kham-actions.js';

test('Kham ranking excludes wheelchair and fan-benefit-only options', () => {
  const ranked = rankKhamOffers([
    { text: '輪椅席 $9,430', price: 9430, kind: 'select', index: 0 },
    { text: 'VIP 1 區 $9,430 視線遮蔽', price: 9430, kind: 'select', index: 1 },
    { text: 'VIP 2 區 $9,380', price: 9380, kind: 'select', index: 2 },
    { text: 'VIP 粉絲福利 $20', price: 20, kind: 'select', index: 3 },
  ]);

  assert.deepEqual(
    ranked.map((offer) => offer.index),
    [2, 1],
  );
});

test('Kham ranking uses price when availability quality is otherwise equal', () => {
  const ranked = rankKhamOffers([
    { text: 'A 區 $6,880', price: 6880, kind: 'select', index: 0 },
    { text: 'VIP 3 區 $8,880', price: 8880, kind: 'select', index: 1 },
  ]);

  assert.deepEqual(
    ranked.map((offer) => offer.index),
    [1, 0],
  );
});

test('Kham product row price ignores the event year and reads the actual ticket price', () => {
  assert.equal(priceFromKhamText('2027/02/28(日)18:30 高雄國家體育場 8380 立即訂購'), 8380);
  assert.equal(priceFromKhamText('VIP 1 $9,430 立即訂購'), 9430);
});

test('Kham product list clicks the highest-priced compatible immediate-order row', async () => {
  const rows = [
    { text: '2027/02/28 8380 立即訂購', clicked: false },
    { text: '2027/02/28 9430 輪椅席 立即訂購', clicked: false },
    { text: '2027/02/28 9380 VIP 2 立即訂購', clicked: false },
  ];
  const collection = {
    or: () => collection,
    count: async () => rows.length,
    nth: (index) => ({
      isVisible: async () => true,
      isEnabled: async () => true,
      evaluate: async () => rows[index].text,
      click: async () => { rows[index].clicked = true; },
    }),
  };
  const page = { getByRole: () => collection };

  const result = await clickBestKhamPurchaseOption(page, {
    preferNonObstructed: true,
    allowObstructedFallback: true,
  });

  assert.equal(result.clicked, true);
  assert.equal(result.option.price, 9380);
  assert.deepEqual(rows.map((row) => row.clicked), [false, false, true]);
});

test('sale instructions saying sold out eventually are not treated as a sold-out result', () => {
  assert.equal(classifyKhamPage('票券數量有限，售完為止。'), 'unknown');
  assert.equal(classifyKhamPage('Priority purchase does not guarantee a better queue number.'), 'unknown');
  assert.equal(classifyKhamPage('您正在排隊中，請耐心等候進入'), 'challenge');
  assert.equal(classifyKhamPage('本場次已售完'), 'sold-out');
});

test('Kham card prefix accepts exactly six digits', () => {
  assert.equal(normalizeKhamCardPrefix(' 123456 '), '123456');
  assert.throws(() => normalizeKhamCardPrefix('12345'), /剛好 6 位數字/);
  assert.throws(() => normalizeKhamCardPrefix('12345x'), /剛好 6 位數字/);
});

test('Kham card prefix fills the visible CTBC validation input', async () => {
  const filled = [];
  const elements = [
    { description: '會員帳號', visible: true },
    { description: '中國信託卡友優先購－信用卡號前六碼', visible: true },
  ];
  const page = {
    locator: () => ({
      count: async () => elements.length,
      nth: (index) => ({
        isVisible: async () => elements[index].visible,
        evaluate: async () => elements[index].description,
        fill: async (value) => filled.push({ index, value }),
      }),
    }),
  };

  assert.equal(await fillKhamCardPrefix(page, '123456'), true);
  assert.deepEqual(filled, [{ index: 1, value: '123456' }]);
});

test('Kham card validation clicks only a clearly named verification control', async () => {
  let clicked = false;
  const candidate = {
    or: () => candidate,
    first: () => candidate,
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    click: async () => { clicked = true; },
  };
  const page = { getByRole: () => candidate };

  assert.equal(await submitKhamCardValidation(page), true);
  assert.equal(clicked, true);
});
