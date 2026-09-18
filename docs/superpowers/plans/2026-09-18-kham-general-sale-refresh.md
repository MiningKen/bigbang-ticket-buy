# Kham General-Sale Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Kham assistant wait for stable inventory, cycle both performances until stopped, and support either one ticket or an adjacent pair with a one-ticket fallback.

**Architecture:** Keep browser-specific DOM operations in `kham-actions.js`, put deterministic priority and cycle rules in a new pure `kham-strategy.js`, and let `KhamController` orchestrate a single browser tab. Runtime quantity preference is set through the local control API; general sale is the production default while CTBC remains an explicit rehearsal mode.

**Tech Stack:** Node.js 22, ECMAScript modules, `node:test`, `playwright-core`, static HTML/CSS/JavaScript control panel.

## Global Constraints

- General sale starts at 2026-09-22 10:00 Asia/Taipei and does not require a card prefix.
- Refresh uses Kham's native “更新票數” control at randomized 3–5 second intervals.
- Refresh continues until a compatible ticket reaches confirmed handoff or the user presses Stop.
- Two-ticket mode accepts only a confirmed adjacent pair and otherwise falls back to exactly one ticket.
- Priority is 2/28 pair, 2/27 pair, 2/28 single, 2/27 single; within a level use non-obstructed before obstructed, then higher price first.
- Wheelchair, accessible, and companion inventory is always excluded.
- Unknown dialogs, queue/CAPTCHA, login loss, or HTTP 403/429 pause automation for manual action.
- Full card numbers, identity data, cookies, and payment data are never persisted or logged.

---

### Task 1: General-sale configuration and deterministic attempt strategy

**Files:**
- Create: `src/kham-strategy.js`
- Modify: `src/kham-config.js`
- Create: `test/kham-strategy.test.js`
- Modify: `test/kham-config.test.js`

**Interfaces:**
- Produces: `buildKhamAttemptPlan(ticketMode, primary, fallback)` returning ordered `{ product, ticketCount, adjacencyRequired }` attempts.
- Produces: `nextKhamRefreshDelay(random = Math.random)` returning an integer from 3000 through 5000.
- Produces: config fields `saleMode`, `ticketMode`, `refreshMinMs`, and `refreshMaxMs`.

- [ ] **Step 1: Write failing strategy and configuration tests**

```js
test('two-adjacent mode searches both pairs before either single', () => {
  assert.deepEqual(buildKhamAttemptPlan('adjacent-two-then-one', primary, fallback), [
    { product: primary, ticketCount: 2, adjacencyRequired: true },
    { product: fallback, ticketCount: 2, adjacencyRequired: true },
    { product: primary, ticketCount: 1, adjacencyRequired: false },
    { product: fallback, ticketCount: 1, adjacencyRequired: false },
  ]);
});

test('refresh delay stays between three and five seconds', () => {
  assert.equal(nextKhamRefreshDelay(() => 0), 3000);
  assert.equal(nextKhamRefreshDelay(() => 1), 5000);
});

test('Kham defaults to the September 22 general sale', () => {
  const config = readKhamConfig({}, '/tmp/kham-config-test');
  assert.equal(config.saleMode, 'general-sale');
  assert.equal(config.saleStart.toISOString(), '2026-09-22T02:00:00.000Z');
  assert.equal(config.ticketMode, 'single');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/kham-strategy.test.js test/kham-config.test.js`

Expected: FAIL because `kham-strategy.js` and the new configuration fields do not exist.

- [ ] **Step 3: Implement the strategy and configuration**

```js
export function buildKhamAttemptPlan(ticketMode, primary, fallback) {
  if (ticketMode === 'single') {
    return [primary, fallback].map((product) => ({ product, ticketCount: 1, adjacencyRequired: false }));
  }
  if (ticketMode !== 'adjacent-two-then-one') throw new Error('Invalid Kham ticket mode');
  return [
    { product: primary, ticketCount: 2, adjacencyRequired: true },
    { product: fallback, ticketCount: 2, adjacencyRequired: true },
    { product: primary, ticketCount: 1, adjacencyRequired: false },
    { product: fallback, ticketCount: 1, adjacencyRequired: false },
  ];
}

export function nextKhamRefreshDelay(random = Math.random) {
  return 3000 + Math.floor(random() * 2001);
}
```

Set `KHAM_SALE_MODE` default to `general-sale`, `KHAM_SALE_START` default to `2026-09-22T10:00:00+08:00`, `KHAM_TICKET_MODE` default to `single`, and retain card-prefix validation only when `saleMode === 'ctbc-rehearsal'`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/kham-strategy.test.js test/kham-config.test.js`

Expected: all strategy and Kham config tests pass.

---

### Task 2: Stable inventory inspection and native refresh

**Files:**
- Modify: `src/kham-actions.js`
- Modify: `test/kham-actions.test.js`

**Interfaces:**
- Produces: `inspectKhamInventory(page)` returning `{ loading, rows }` with row text, price, availability, accessibility, obstruction, and DOM index.
- Produces: `waitForKhamInventory(page, timeoutMs)` returning the first non-loading snapshot or `{ loading: true, rows: [] }` on timeout.
- Produces: `refreshKhamInventory(page)` clicking exactly one visible enabled “更新票數” control.
- Produces: `selectBestKhamArea(page, snapshot, config)` clicking the highest-ranked compatible available row.

- [ ] **Step 1: Write failing tests for loading and row-scoped inventory**

```js
test('inventory loading prevents sold-out classification', () => {
  const snapshot = classifyKhamInventory({
    loading: true,
    rows: [{ text: '平面A2區 8380 已售完', price: 8380, available: false }],
  });
  assert.equal(snapshot.status, 'loading');
});

test('inventory ranking excludes accessible areas and prefers non-obstructed price', () => {
  const ranked = rankKhamAreas([
    { index: 0, text: '輪椅席 9430', price: 9430, available: true },
    { index: 1, text: '遮蔽區 9380', price: 9380, available: true },
    { index: 2, text: '一般區 8880', price: 8880, available: true },
  ]);
  assert.deepEqual(ranked.map((row) => row.index), [2, 1]);
});
```

- [ ] **Step 2: Run the focused action tests and verify RED**

Run: `node --test test/kham-actions.test.js`

Expected: FAIL because inventory inspection, classification, ranking, and refresh functions are absent.

- [ ] **Step 3: Implement stable inventory primitives**

Use visible overlay/spinner selectors plus the enabled state of the native update control to derive `loading`. Extract each ticket table row independently and mark it available only when that row lacks a sold-out label and contains a clickable area control. Reuse the existing wheelchair and obstruction patterns for `rankKhamAreas`. `waitForKhamInventory` polls every 100 ms until loading disappears or the explicit timeout is reached; it never treats a loading snapshot as sold out.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/kham-actions.test.js`

Expected: all Kham action tests pass, including the 2026-09-18 loading screenshot scenario represented by fixtures.

---

### Task 3: Quantity selection and strict adjacency outcome

**Files:**
- Modify: `src/kham-actions.js`
- Modify: `src/kham-strategy.js`
- Modify: `test/kham-actions.test.js`
- Modify: `test/kham-strategy.test.js`

**Interfaces:**
- Produces: `selectKhamQuantity(page, ticketCount)` selecting exactly `1` or `2` from a visible quantity control.
- Produces: `classifyKhamAllocation(text, requestedCount)` returning `confirmed`, `adjacent-unavailable`, `unknown`, or `single-confirmed`.
- Produces: `areKhamSeatsAdjacent(seatLabels)` for explicit assigned-seat verification.

- [ ] **Step 1: Write failing quantity and adjacency tests**

```js
test('two separated assigned seats are rejected', () => {
  assert.equal(areKhamSeatsAdjacent(['A區 3排 8號', 'A區 3排 10號']), false);
  assert.equal(areKhamSeatsAdjacent(['A區 3排 8號', 'A區 3排 9號']), true);
});

test('allocation error triggers single fallback instead of accepting two seats', () => {
  assert.equal(classifyKhamAllocation('無法配置兩張連號座位', 2), 'adjacent-unavailable');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/kham-actions.test.js test/kham-strategy.test.js`

Expected: FAIL because adjacency helpers are absent.

- [ ] **Step 3: Implement strict quantity and adjacency handling**

Select only an exact numeric quantity option. For a pair, accept progression only when Kham explicitly confirms a contiguous allocation or two parsed seat labels share area/row and consecutive seat numbers. Treat “無法連號”, “無連續座位”, “剩餘座位不足”, and separated labels as `adjacent-unavailable`; never downgrade the same attempt into two separated tickets.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/kham-actions.test.js test/kham-strategy.test.js`

Expected: all quantity and adjacency tests pass.

---

### Task 4: Continuous single-tab controller cycle

**Files:**
- Modify: `src/kham-controller.js`
- Modify: `test/kham-controller.test.js`

**Interfaces:**
- Consumes: `buildKhamAttemptPlan`, `nextKhamRefreshDelay`, stable inventory functions, and strict allocation functions.
- Produces: `runAttempt(attempt, config)` with results `selected`, `unavailable`, `adjacent-unavailable`, `blocked`, or `stopped`.
- Produces: an outer cycle that continues until `selected`, `blocked`, or manual Stop.

- [ ] **Step 1: Write failing controller-cycle tests**

```js
test('controller repeats 2/28 and 2/27 until selected', async () => {
  const controller = new FlowController([
    { reason: 'unavailable' }, { reason: 'unavailable' },
    { reason: 'unavailable' }, { reason: 'selected' },
  ]);
  await controller.start();
  assert.deepEqual(controller.attempts, [
    ['2027-02-28', 1], ['2027-02-27', 1],
    ['2027-02-28', 1], ['2027-02-27', 1],
  ]);
});

test('two-ticket mode completes both pair attempts before a single', async () => {
  const controller = new FlowController([
    { reason: 'adjacent-unavailable' },
    { reason: 'adjacent-unavailable' },
    { reason: 'selected' },
  ], 'adjacent-two-then-one');
  await controller.start();
  assert.deepEqual(controller.attempts, [
    ['2027-02-28', 2], ['2027-02-27', 2], ['2027-02-28', 1],
  ]);
});
```

- [ ] **Step 2: Run controller tests and verify RED**

Run: `node --test test/kham-controller.test.js`

Expected: FAIL because the current controller runs each date only once and requires a card prefix unconditionally.

- [ ] **Step 3: Implement the continuous cycle**

Replace the one-shot primary/fallback block with an outer `while (!stopRequested)` over `buildKhamAttemptPlan`. Between unavailable attempts, wait `nextKhamRefreshDelay()` while checking Stop at least every 250 ms. General sale bypasses all card-prefix behavior. CTBC rehearsal retains the existing prefix submission but waits for stable inventory after submission. Register a page response listener that sets a restriction flag on Kham HTTP 403/429 and turns the next controller result into `blocked`.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run: `node --test test/kham-controller.test.js`

Expected: all controller priority, repeat, Stop, and blocked-state tests pass.

---

### Task 5: Runtime UI quantity choice and general-sale copy

**Files:**
- Modify: `src/kham-control-server.js`
- Modify: `src/kham-controller.js`
- Modify: `ui/kham.html`
- Modify: `ui/kham-app.js`
- Modify: `ui/styles.css`
- Modify: `test/kham-controller.test.js`

**Interfaces:**
- Produces: `KhamController.setTicketMode(value)` accepting `single` or `adjacent-two-then-one` only while stopped.
- Produces: `POST /api/preferences` with `{ ticketMode }`.
- UI renders a labeled select and disables it while running.

- [ ] **Step 1: Write failing runtime-preference tests**

```js
test('runtime ticket mode accepts only the two supported choices', () => {
  const controller = new KhamController('/tmp/kham-controller-test');
  assert.equal(controller.setTicketMode('adjacent-two-then-one').config.ticketMode, 'adjacent-two-then-one');
  assert.throws(() => controller.setTicketMode('two-separated'), /票數模式/);
});
```

- [ ] **Step 2: Run controller tests and verify RED**

Run: `node --test test/kham-controller.test.js`

Expected: FAIL because the runtime setter is absent.

- [ ] **Step 3: Implement API and UI controls**

Add a select with values `single` and `adjacent-two-then-one`. Submit changes immediately to `/api/preferences`, render the selected state from `state.config.ticketMode`, and show the exact priority copy in the settings panel. Hide the card-prefix form when `saleMode === 'general-sale'`. Update phase labels for inventory loading and refreshing, and change the start button text to `開始等待 9/22 10:00`.

- [ ] **Step 4: Run focused tests and a static UI smoke check**

Run: `node --test test/kham-controller.test.js && node --check ui/kham-app.js`

Expected: tests pass and JavaScript syntax check exits 0.

---

### Task 6: Documentation, full verification, and safe rehearsal

**Files:**
- Modify: `KHAM-README.md`
- Modify: `WINDOWS-README.txt`
- Modify: `.kham.env.example`
- Modify: `.env.example` only if it documents Kham variables.

**Interfaces:**
- Documents the one-ticket and adjacent-pair modes, general-sale start, continuous Stop behavior, manual handoff, and CTBC rehearsal boundary.

- [ ] **Step 1: Update user documentation and examples**

Document `KHAM_SALE_MODE=general-sale`, `KHAM_SALE_START=2026-09-22T10:00:00+08:00`, the UI ticket-mode selector, 3–5 second native refresh, exact quantity/date priority, and the requirement that real-name lists be prepared before sale.

- [ ] **Step 2: Run the full automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run syntax and packaging checks**

Run: `node --check src/kham-controller.js && node --check src/kham-actions.js && node --check ui/kham-app.js && npm run package:windows`

Expected: all syntax checks exit 0 and the Windows packaging command completes without error.

- [ ] **Step 4: Run a safe live rehearsal**

Use `ctbc-rehearsal` only to verify the known real-name notice, purchase list, prefix eligibility transition, inventory loading wait, and native refresh. Stop before selecting an available ticket area or submitting any order. Capture sanitized diagnostic evidence and restore `general-sale` defaults afterward.

- [ ] **Step 5: Verify the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only planned source, test, UI, documentation, and generated Windows package files are changed.
