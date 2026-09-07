import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { attachDashboardShutdown } from '../src/dashboard-lifecycle.js';

test('closing the control-panel page shuts down the local service', () => {
  const dashboardBrowser = new EventEmitter();
  const dashboardPage = new EventEmitter();
  let shutdownCalls = 0;

  attachDashboardShutdown({
    dashboardBrowser,
    dashboardPage,
    shutdown: () => {
      shutdownCalls += 1;
    },
  });

  dashboardPage.emit('close');
  assert.equal(shutdownCalls, 1);
});
