import { existsSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';

import { findSessionByDate, normalizeSeatingMode } from './sessions.js';

export function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function parsePositiveInteger(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parsePrices(value = '') {
  return value
    .split(',')
    .map((item) => item.replace(/[^0-9]/g, ''))
    .filter(Boolean);
}

export function findBrowserExecutable(
  env = process.env,
  platform = process.platform,
  fileExists = existsSync,
) {
  if (env.CHROME_PATH) return env.CHROME_PATH;

  const candidates = [];
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else if (platform === 'win32') {
    const windowsRoots = [
      env.PROGRAMFILES || env.ProgramFiles,
      env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'],
      env.LOCALAPPDATA || env.LocalAppData,
    ].filter(Boolean);
    for (const root of windowsRoots) {
      candidates.push(
        win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      );
    }
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    );
  }

  return candidates.find((candidate) => fileExists(candidate)) || null;
}

export function priceTextPattern(price) {
  const digits = price.replace(/[^0-9]/g, '');
  if (!digits) throw new Error('price must contain at least one digit');
  const flexibleDigits = digits.split('').join('[,\\s]*');
  return new RegExp(`(?<!\\d)(?:NT\\.?\\s*[$：:]?\\s*)?${flexibleDigits}(?!\\d)`, 'i');
}

export function readConfig(env = process.env, cwd = process.cwd()) {
  const pollMinMs = parsePositiveInteger(env.POLL_MIN_MS, 15_000, 'POLL_MIN_MS');
  const pollMaxMs = parsePositiveInteger(env.POLL_MAX_MS, 25_000, 'POLL_MAX_MS');
  if (pollMaxMs < pollMinMs) {
    throw new Error('POLL_MAX_MS must be greater than or equal to POLL_MIN_MS');
  }

  const targetDate = env.TARGET_DATE || '2026-10-09';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('TARGET_DATE must use YYYY-MM-DD');
  }
  const knownSession = findSessionByDate(targetDate);
  const internalSessionId = env.INTERNAL_SESSION_ID || knownSession?.internalSessionId;
  if (!internalSessionId) {
    throw new Error(`No INTERNAL_SESSION_ID configured for ${targetDate}`);
  }

  const ticketCount = parsePositiveInteger(env.TICKET_COUNT, 1, 'TICKET_COUNT');
  if (ticketCount > 4) throw new Error('TICKET_COUNT cannot exceed 4 for this event');

  return {
    ticketUrl:
      env.TICKET_URL ||
      'https://ticketplus.com.tw/activity/21d3c3504ff522a6732789a46f5796d7',
    targetDate,
    ticketCount,
    internalEventId: env.INTERNAL_EVENT_ID || 'e000001447',
    internalSessionId,
    preferredPrices: parsePrices(env.PREFERRED_PRICES),
    seatingMode: normalizeSeatingMode(
      env.SEATING_MODE,
      parseBoolean(env.ALLOW_NON_ADJACENT),
    ),
    acceptTerms: parseBoolean(env.ACCEPT_TERMS),
    autoAdvance: parseBoolean(env.AUTO_ADVANCE),
    pollMinMs,
    pollMaxMs,
    profileDir: resolve(cwd, '.ticketplus-profile'),
    artifactsDir: resolve(cwd, 'artifacts'),
    chromePath: findBrowserExecutable(env),
  };
}

export function isAvailableApiStatus(status) {
  return ['onsale', 'available'].includes(String(status).toLowerCase());
}

export function nextPollDelay(config, random = Math.random) {
  const span = config.pollMaxMs - config.pollMinMs;
  return config.pollMinMs + Math.floor(random() * (span + 1));
}
