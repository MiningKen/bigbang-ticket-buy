export const KHAM_TICKET_MODES = new Set(['single', 'adjacent-two-then-one']);

export function buildKhamAttemptPlan(ticketMode, primary, fallback) {
  if (ticketMode === 'single') {
    return [primary, fallback].map((product) => ({
      product,
      ticketCount: 1,
      adjacencyRequired: false,
    }));
  }
  if (ticketMode !== 'adjacent-two-then-one') {
    throw new Error('Invalid Kham ticket mode');
  }
  return [
    { product: primary, ticketCount: 2, adjacencyRequired: true },
    { product: fallback, ticketCount: 2, adjacencyRequired: true },
    { product: primary, ticketCount: 1, adjacencyRequired: false },
    { product: fallback, ticketCount: 1, adjacencyRequired: false },
  ];
}

export function nextKhamRefreshDelay(random = Math.random) {
  const ratio = Math.min(1, Math.max(0, random()));
  return 3_000 + Math.floor(ratio * 2_000);
}
