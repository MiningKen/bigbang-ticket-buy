import test from 'node:test';
import assert from 'node:assert/strict';

import { pageForExistingContext } from '../src/browser-session.js';

test('creates a new page when the tracked Ticket Plus page was closed', async () => {
  const replacementPage = { isClosed: () => false };
  let newPageCalls = 0;
  const context = {
    pages: () => [],
    async newPage() {
      newPageCalls += 1;
      return replacementPage;
    },
  };
  const closedPage = { isClosed: () => true };

  const result = await pageForExistingContext(context, closedPage);

  assert.equal(result, replacementPage);
  assert.equal(newPageCalls, 1);
});
