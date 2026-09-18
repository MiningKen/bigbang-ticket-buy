import { resolve } from 'node:path';

import { findBrowserExecutable } from './config.js';
import { KHAM_TICKET_MODES } from './kham-strategy.js';

const PRIMARY = {
  date: '2027-02-28',
  label: '2/28（日）18:30 高雄國家體育場',
  url: 'https://kham.com.tw/application/UTK02/UTK0201_.aspx?PRODUCT_ID=P1EVUYWG',
};

const FALLBACK = {
  date: '2027-02-27',
  label: '2/27（六）18:30 高雄國家體育場',
  url: 'https://kham.com.tw/application/UTK02/UTK0201_.aspx?PRODUCT_ID=P1EMCIC6',
};

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parsePositiveInteger(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function readKhamConfig(env = process.env, cwd = process.cwd()) {
  const legacyTicketCount = parsePositiveInteger(env.KHAM_TICKET_COUNT, 1, 'KHAM_TICKET_COUNT');
  if (legacyTicketCount > 2) throw new Error('KHAM_TICKET_COUNT cannot exceed 2');
  const ticketMode = env.KHAM_TICKET_MODE
    || (legacyTicketCount === 2 ? 'adjacent-two-then-one' : 'single');
  if (!KHAM_TICKET_MODES.has(ticketMode)) {
    throw new Error('KHAM_TICKET_MODE must be single or adjacent-two-then-one');
  }
  const ticketCount = ticketMode === 'adjacent-two-then-one' ? 2 : 1;

  const saleMode = env.KHAM_SALE_MODE || 'general-sale';
  if (!['general-sale', 'ctbc-rehearsal'].includes(saleMode)) {
    throw new Error('KHAM_SALE_MODE must be general-sale or ctbc-rehearsal');
  }

  const saleStart = new Date(env.KHAM_SALE_START || '2026-09-22T10:00:00+08:00');
  if (Number.isNaN(saleStart.valueOf())) throw new Error('KHAM_SALE_START must be an ISO timestamp');

  const acceptTerms = parseBoolean(env.KHAM_ACCEPT_TERMS, true);
  const autoAdvance = parseBoolean(env.KHAM_AUTO_ADVANCE, true);
  if (autoAdvance && !acceptTerms) {
    throw new Error('KHAM_AUTO_ADVANCE requires KHAM_ACCEPT_TERMS=true');
  }

  return {
    primary: PRIMARY,
    fallback: FALLBACK,
    saleMode,
    saleStart,
    ticketMode,
    ticketCount,
    refreshMinMs: 3_000,
    refreshMaxMs: 5_000,
    acceptTerms,
    autoAdvance,
    wantVipBenefit: parseBoolean(env.KHAM_WANT_VIP_BENEFIT, true),
    preferNonObstructed: parseBoolean(env.KHAM_PREFER_NON_OBSTRUCTED, true),
    allowObstructedFallback: parseBoolean(env.KHAM_ALLOW_OBSTRUCTED_FALLBACK, true),
    profileDir: resolve(cwd, '.kham-profile'),
    artifactsDir: resolve(cwd, 'artifacts'),
    chromePath: findBrowserExecutable(env),
  };
}
