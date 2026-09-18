# Kham General-Sale Reliability Design

## Goal

Prepare the Kham browser assistant for the BIGBANG general sale on 2026-09-22
at 10:00 Asia/Taipei. The assistant must prefer the 2027-02-28 performance,
fall back to 2027-02-27 only after definitive unavailability, request one
non-accessible ticket, prefer non-obstructed inventory, and then prefer higher
prices.

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
- explicit sold-out and available ticket-selection variants.

The fixture runner exercises the same stage detection and transition rules used
by the live controller. Tests prove that the year is not parsed as the price,
unknown messages pause instead of falling back, definitive sold-out results do
fall back, and general-sale mode never accesses card-prefix behavior.

The live rehearsal is an additional observation tool, not proof that 9/22
inventory or markup will be identical. Before the scheduled run, the user must
be logged in and the real-name attendee list must already be correct.

## User Interface and Documentation

The Kham control panel displays the active sale mode and 2026-09-22 10:00 sale
time. In general-sale mode it hides the card-prefix form and does not block
startup on missing digits. Status messages distinguish “clicked”, “stage
confirmed”, “blocked by message”, “definitively unavailable”, and “handed to
user”; they never report a ticket as obtained unless the page confirms the
handoff stage.

The README documents both the general-sale workflow and the safe rehearsal
boundary. Windows and macOS one-click launch behavior remains unchanged.

## Success Criteria

- General-sale startup requires no card prefix and waits for 2026-09-22 10:00
  Asia/Taipei.
- The 2/28 performance is attempted before 2/27.
- Fallback occurs only for a scoped, definitive unavailable result.
- Unknown dialogs stop automation and preserve the browser for the user.
- Price parsing selects the actual ticket price rather than an event year.
- All state-machine fixture tests and the existing test suite pass.
- A live CTBC rehearsal can identify the post-prefix stage without reserving a
  ticket or submitting an order.
