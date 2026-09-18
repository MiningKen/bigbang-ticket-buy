import test from 'node:test';
import assert from 'node:assert/strict';

import {
  areKhamSeatsAdjacent,
  classifyKhamAllocation,
  classifyKhamPage,
  classifyKhamInventory,
  clickBestKhamPurchaseOption,
  dismissKhamRealNameNotice,
  fillKhamCardPrefix,
  normalizeKhamCardPrefix,
  priceFromKhamText,
  rankKhamAreas,
  rankKhamOffers,
  selectKhamQuantity,
  submitKhamCardValidation,
} from '../src/kham-actions.js';
import * as khamActions from '../src/kham-actions.js';

test('Kham diagnostics expose page structure without input values', async () => {
  assert.equal(typeof khamActions.inspectKhamPage, 'function');

  const page = {
    url: () => 'https://kham.example/checkout',
    title: async () => '寬宏售票系統',
    evaluate: async () => ({
      dialogs: [{ text: '目前無法購票', controls: ['確定'] }],
      visibleInputs: [{ type: 'text', name: 'card-prefix', placeholder: '卡號前六碼' }],
    }),
  };

  const evidence = await khamActions.inspectKhamPage(page);

  assert.deepEqual(evidence, {
    url: 'https://kham.example/checkout',
    title: '寬宏售票系統',
    dialogs: [{ text: '目前無法購票', controls: ['確定'] }],
    visibleInputs: [{ type: 'text', name: 'card-prefix', placeholder: '卡號前六碼' }],
  });
  assert.equal(JSON.stringify(evidence).includes('418230'), false);
});

test('Kham dismisses only the known real-name informational notice', async () => {
  const dialogs = [
    { text: '未知錯誤，請確認', clicked: false },
    { text: '訊息視窗 本節目採「個人實名制入場」，請於購票前再次確認會員本人資料 Ok', clicked: false },
  ];
  const collection = {
    count: async () => dialogs.length,
    nth: (index) => ({
      isVisible: async () => true,
      innerText: async () => dialogs[index].text,
      getByRole: () => {
        const control = {
          or: () => control,
          first: () => control,
          count: async () => 1,
          isVisible: async () => true,
          isEnabled: async () => true,
          click: async () => { dialogs[index].clicked = true; },
        };
        return control;
      },
    }),
  };
  const page = { locator: () => collection };

  assert.equal(await dismissKhamRealNameNotice(page), true);
  assert.deepEqual(dialogs.map((dialog) => dialog.clicked), [false, true]);
});

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

test('inventory loading prevents sold-out classification', () => {
  assert.deepEqual(classifyKhamInventory({
    loading: true,
    rows: [{ text: '平面A2區 8380 已售完', price: 8380, available: false }],
  }), { status: 'loading', availableRows: [] });
});

test('stable inventory is sold out only when every scoped row is unavailable', () => {
  assert.equal(classifyKhamInventory({
    loading: false,
    rows: [
      { text: 'A區 8380 已售完', price: 8380, available: false },
      { text: 'B區 8380 已售完', price: 8380, available: false },
    ],
  }).status, 'sold-out');

  assert.equal(classifyKhamInventory({
    loading: false,
    rows: [
      { text: 'A區 8380 已售完', price: 8380, available: false },
      { text: 'B區 8380 尚有座位', price: 8380, available: true },
    ],
  }).status, 'available');
});

test('inventory ranking excludes accessible areas and prefers non-obstructed inventory', () => {
  const ranked = rankKhamAreas([
    { index: 0, text: '輪椅席 9430', price: 9430, available: true },
    { index: 1, text: '視線遮蔽區 9380', price: 9380, available: true },
    { index: 2, text: '一般區 8880', price: 8880, available: true },
    { index: 3, text: '一般區 8380 已售完', price: 8380, available: false },
  ]);

  assert.deepEqual(ranked.map((row) => row.index), [2, 1]);
});

test('Kham adjacency requires the same area and row with consecutive seat numbers', () => {
  assert.equal(areKhamSeatsAdjacent(['A區 3排 8號', 'A區 3排 9號']), true);
  assert.equal(areKhamSeatsAdjacent(['A區 3排 8號', 'A區 3排 10號']), false);
  assert.equal(areKhamSeatsAdjacent(['A區 3排 8號', 'B區 3排 9號']), false);
  assert.equal(areKhamSeatsAdjacent(['A區 3排 8號']), false);
});

test('Kham allocation rejects an explicitly non-adjacent pair and recognizes confirmed seats', () => {
  assert.equal(classifyKhamAllocation('無法配置兩張連號座位', 2), 'adjacent-unavailable');
  assert.equal(classifyKhamAllocation('剩餘座位不足，無連續座位', 2), 'adjacent-unavailable');
  assert.equal(classifyKhamAllocation('系統已成功配置兩張連號座位', 2), 'confirmed');
  assert.equal(classifyKhamAllocation('A區 3排 8號、A區 3排 9號', 2), 'confirmed');
  assert.equal(classifyKhamAllocation('A區 3排 8號、A區 3排 10號', 2), 'adjacent-unavailable');
  assert.equal(classifyKhamAllocation('A區 3排 8號', 1), 'single-confirmed');
  assert.equal(classifyKhamAllocation('請選擇座位', 2), 'unknown');
});

test('Kham quantity selection chooses the exact requested count', async () => {
  const selections = [];
  const page = {
    evaluate: async () => ({ kind: 'select', index: 1, value: '2' }),
    locator: () => ({
      nth: (index) => ({ selectOption: async (value) => selections.push({ index, value }) }),
    }),
  };

  assert.equal(await selectKhamQuantity(page, 2), true);
  assert.deepEqual(selections, [{ index: 1, value: '2' }]);
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
