import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyKhamPage, rankKhamOffers } from '../src/kham-actions.js';

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

test('sale instructions saying sold out eventually are not treated as a sold-out result', () => {
  assert.equal(classifyKhamPage('票券數量有限，售完為止。'), 'unknown');
  assert.equal(classifyKhamPage('本場次已售完'), 'sold-out');
});
