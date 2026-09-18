# Kham General-Sale Reliability Design

## Goal

Prepare the Kham browser assistant for the BIGBANG general sale on 2026-09-22
at 10:00 Asia/Taipei. The assistant must cycle through the 2027-02-28 and
2027-02-27 performances until a compatible ticket is secured or the user stops
it. It excludes accessible inventory, prefers non-obstructed inventory, and then
prefers higher prices.

The assistant may use the live 2026-09-18 CTBC presale flow as a rehearsal.
The rehearsal may enter the first six card digits and inspect the ticket-selection
page, but it must stop before any action that reserves inventory, submits an
order, or enters payment.

## Sale Modes

The controller has two explicit modes:

- `ctbc-rehearsal`: requires an in-memory six-digit card prefix and may submit
  only the CTBC eligibility form. It stops when the next ticket-selection stage
  is identified.
- `general-sale`: starts at 2026-09-22 10:00 Asia/Taipei and never requests,
  stores, fills, or submits a card prefix. It proceeds through ticket selection
  and may press the existing single safe “next” action, then hands control to
  the user for real-name confirmation and payment.

Production defaults to `general-sale`. Rehearsal is an explicit, temporary
operator action and cannot be confused with the scheduled run.

## Browser State Machine

The browser flow uses explicit stages rather than searching the entire body for
keywords:

1. `product`: the official product page and its purchase control are visible.
2. `performance-list`: compatible “立即訂購” rows are visible and ranked.
3. `eligibility`: a visible, unobscured CTBC prefix dialog is present; this
   stage exists only in `ctbc-rehearsal`.
4. `ticket-selection`: ticket areas or quantity controls are visible.
5. `handoff`: the assistant has made the allowed selection and the user must
   confirm real-name data and payment.
6. `blocked`: a queue, CAPTCHA, unknown message, login problem, or changed page
   requires manual action.

An action is logged as successful only after an observable postcondition is
confirmed. Clicking a control is not itself success. URL, visible stage-specific
controls, and visible modal state are captured before and after every important
action.

The ticket-selection page has an explicit inventory-loading state. The
assistant does not inspect availability while the page overlay, spinner, or
native “更新票數” operation is active. “已售完” is final only after loading has
finished and it belongs to the currently inspected ticket-area row.

## Ticket Quantity and Adjacency

The control panel offers exactly two modes:

- `1 張`: request one compatible ticket.
- `2 張連號優先，失敗則 1 張`: attempt exactly two adjacent tickets first;
  if no acceptable adjacent pair can be secured across both dates, request one
  ticket instead.

Two separated seats are never accepted. The presence of two available tickets
does not prove adjacency; the Kham allocation or seat-selection result must
confirm the pair. If a two-ticket attempt reports that adjacent allocation is
unavailable, that attempt is abandoned without accepting separated seats.

The priority order in two-ticket mode is:

1. 2/28, two adjacent tickets.
2. 2/27, two adjacent tickets.
3. 2/28, one ticket.
4. 2/27, one ticket.

Within each level, non-obstructed inventory precedes obstructed inventory, then
prices are attempted from highest to lowest. Wheelchair, accessible, and
companion inventory is always excluded.

## Continuous Inventory Refresh

After the initial attempt finds no compatible inventory, the assistant remains
active until a compatible ticket is secured or the user presses Stop. It uses
the page's native “更新票數” control with a randomized 3–5 second interval; it
does not reload while an inventory update is already in progress.

One cycle inspects all compatible price levels for 2/28, then all compatible
price levels for 2/27, and then returns to 2/28. In two-ticket mode the cycle
first completes the adjacent-pair priority levels across both dates and only
then performs the single-ticket fallback levels across both dates. A new cycle
begins if neither pass succeeds.

Queue pages, CAPTCHA, login loss, unknown dialogs, HTTP 403/429 responses, and
unexpected markup pause automation and preserve the browser for manual action.
The assistant never opens parallel purchase tabs, which could race the same
session or shopping cart.

## Dialog and Error Handling

Native browser dialogs are observed before navigation. Their type and exact
message are recorded; unknown dialogs are not silently accepted. Visible HTML
dialogs are inspected separately from the page body, including their text and
available buttons.

The assistant automatically continues only through a recognized CTBC prefix
dialog in rehearsal mode. A recognized definitive inventory-unavailable message
may trigger the fallback performance. An unknown or eligibility-error dialog
enters `blocked`, brings the Kham browser to the foreground, sounds the alert,
and preserves the page for manual inspection.

Sold-out classification is scoped to the currently selected performance or
visible result dialog. General event instructions such as “售完為止” and text
belonging to another row never trigger fallback.

## Evidence and Diagnostics

For each transition the assistant records:

- timestamp, mode, old stage, requested action, and resulting stage;
- current URL and page title;
- sanitized visible dialog text;
- the selected performance row and parsed ticket price;
- a screenshot on blocked, unavailable, and handoff outcomes.

Card digits, full identity data, cookies, and payment data are never written to
logs, state responses, screenshots intentionally taken while the prefix field is
populated, or fixture files. A screenshot after prefix submission is delayed
until the sensitive dialog has disappeared.

## Simulation and Tests

Local HTML fixtures reproduce the observed sequence from 2026-09-18:

- product page to performance list;
- an 8380-dollar row whose text also contains the years 2026 and 2027;
- CTBC eligibility dialog and successful transition;
- an error/unknown message after eligibility submission;
- explicit sold-out and available ticket-selection variants;
- an inventory page whose initial rows say “已售完” while “更新票數” is still
  loading;
- two adjacent tickets, two separated tickets, and a one-ticket fallback;
- a full 2/28 → 2/27 → 2/28 refresh cycle.

The fixture runner exercises the same stage detection and transition rules used
by the live controller. Tests prove that the year is not parsed as the price,
unknown messages pause instead of falling back, definitive sold-out results do
not stop continuous refresh, separated seats are rejected, quantity fallback
uses the required priority order, and general-sale mode never accesses
card-prefix behavior.

The live rehearsal is an additional observation tool, not proof that 9/22
inventory or markup will be identical. Before the scheduled run, the user must
be logged in and the real-name attendee list must already be correct.

## User Interface and Documentation

The Kham control panel displays the active sale mode and 2026-09-22 10:00 sale
time. It provides the two ticket-quantity modes above. In general-sale mode it
hides the card-prefix form and does not block startup on missing digits. Status
messages distinguish “clicked”, “waiting for inventory”, “refreshing”, “pair
unavailable”, “single-ticket fallback”, “blocked by message”, and “handed to
user”; they never report a ticket as obtained unless the page confirms the
handoff stage.

The README documents both the general-sale workflow and the safe rehearsal
boundary. Windows and macOS one-click launch behavior remains unchanged.

## Success Criteria

- General-sale startup requires no card prefix and waits for 2026-09-22 10:00
  Asia/Taipei.
- The control panel supports one-ticket mode and adjacent-pair-with-single-
  fallback mode.
- Two separated tickets are never accepted.
- Two-ticket mode follows 2/28 pair, 2/27 pair, 2/28 single, 2/27 single.
- Inventory is never classified while the native refresh is still loading.
- With no compatible inventory, 2/28 and 2/27 continue cycling every 3–5
  seconds until success or manual Stop.
- Unknown dialogs stop automation and preserve the browser for the user.
- Price parsing selects the actual ticket price rather than an event year.
- All state-machine fixture tests and the existing test suite pass.
- A live CTBC rehearsal can identify the post-prefix stage without reserving a
  ticket or submitting an order.
