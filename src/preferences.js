import { findSessionByDate, normalizeSeatingMode } from './sessions.js';

export const POLL_MODES = {
  fast: { min: 5_000, max: 8_000, label: '快速（5–8 秒）' },
  balanced: { min: 10_000, max: 15_000, label: '標準（10–15 秒）' },
  conservative: { min: 15_000, max: 25_000, label: '保守（15–25 秒）' },
};

export function inferPollMode(min, max) {
  return Object.entries(POLL_MODES).find(([, value]) => value.min === min && value.max === max)?.[0] || 'custom';
}

export function validatePreferences(input) {
  const session = findSessionByDate(String(input.targetDate || ''));
  if (!session) throw new Error('請選擇有效的場次日期');

  const ticketCount = Number.parseInt(input.ticketCount, 10);
  if (!Number.isInteger(ticketCount) || ticketCount < 1 || ticketCount > 4) {
    throw new Error('票數必須是 1–4');
  }

  const seatingMode = normalizeSeatingMode(String(input.seatingMode || ''));
  const pollMode = String(input.pollMode || 'fast');
  if (!POLL_MODES[pollMode]) throw new Error('請選擇有效的監看速度');
  const preferredPrices = String(input.preferredPrices || '')
    .split(',')
    .map((price) => price.replace(/[^0-9]/g, ''))
    .filter(Boolean);
  if (preferredPrices.length === 0) throw new Error('請至少輸入一個票價');

  return {
    session,
    ticketCount,
    seatingMode,
    preferredPrices,
    autoAdvance: input.autoAdvance === true,
    pollMode,
  };
}

export function preferencesToEnv(preferences) {
  const poll = POLL_MODES[preferences.pollMode];
  return {
    TARGET_DATE: preferences.session.date,
    INTERNAL_SESSION_ID: preferences.session.internalSessionId,
    TICKET_COUNT: preferences.ticketCount,
    PREFERRED_PRICES: preferences.preferredPrices.join(','),
    SEATING_MODE: preferences.seatingMode,
    ACCEPT_TERMS: preferences.autoAdvance,
    AUTO_ADVANCE: preferences.autoAdvance,
    POLL_MIN_MS: poll.min,
    POLL_MAX_MS: poll.max,
  };
}

export function inferLoginStatus(text) {
  if (/登出|logout/i.test(text)) return 'logged-in';
  if (/會員登入|登入會員|login/i.test(text)) return 'logged-out';
  return 'unknown';
}
