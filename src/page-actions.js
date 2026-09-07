import { isAvailableApiStatus, priceTextPattern } from './config.js';
import { inferLoginStatus } from './preferences.js';

const BUY_PATTERN = /立即購買|購買|buy\s*now|select\s*tickets?/i;
const UNAVAILABLE_PATTERN = /暫無票券|銷售一空|已售完|sold\s*out|not\s*available/i;
const CHALLENGE_PATTERN = /驗證碼|captcha|我不是機器人|排隊中|queue/i;
const SEAT_FAILURE_PATTERN = /無法.*連位|無連續座位|沒有連號|座位不足|無法配位|配位失敗|請勾選.*不連位/i;

export async function inspectTargetSession(page, targetDate) {
  return page.evaluate(
    ({ date, buySource, unavailableSource }) => {
      const buyPattern = new RegExp(buySource, 'i');
      const unavailablePattern = new RegExp(unavailableSource, 'i');
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };

      const rows = [...document.querySelectorAll('tr, [role="row"]')];
      let container = rows.find((row) => row.textContent?.includes(date));

      if (!container) {
        const dateNode = [...document.querySelectorAll('body *')]
          .filter((element) => visible(element) && element.textContent?.includes(date))
          .sort((a, b) => a.textContent.length - b.textContent.length)[0];

        container = dateNode;
        for (let i = 0; container && i < 6; i += 1) {
          const text = container.textContent || '';
          if (text.length >= 20 && (buyPattern.test(text) || unavailablePattern.test(text))) break;
          container = container.parentElement;
        }
      }

      if (!container) return { found: false, text: '', canBuy: false };

      const text = (container.innerText || container.textContent || '').trim();
      const controls = [...container.querySelectorAll('button, a, [role="button"]')].filter(
        (element) => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true',
      );
      const buyControl = controls.find((element) => buyPattern.test(element.innerText || element.textContent || ''));

      return {
        found: true,
        text,
        canBuy: Boolean(buyControl) && !unavailablePattern.test(text),
      };
    },
    {
      date: targetDate,
      buySource: BUY_PATTERN.source,
      unavailableSource: UNAVAILABLE_PATTERN.source,
    },
  );
}

export async function clickTargetSession(page, targetDate) {
  return page.evaluate(
    ({ date, buySource }) => {
      const buyPattern = new RegExp(buySource, 'i');
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      const rows = [...document.querySelectorAll('tr, [role="row"]')];
      let container = rows.find((row) => row.textContent?.includes(date));

      if (!container) {
        const dateNode = [...document.querySelectorAll('body *')]
          .filter((element) => visible(element) && element.textContent?.includes(date))
          .sort((a, b) => a.textContent.length - b.textContent.length)[0];
        container = dateNode;
        for (let i = 0; container && i < 6; i += 1) {
          if ([...container.querySelectorAll('button, a, [role="button"]')].some((element) =>
            buyPattern.test(element.innerText || element.textContent || ''),
          )) break;
          container = container.parentElement;
        }
      }
      if (!container) return false;

      const control = [...container.querySelectorAll('button, a, [role="button"]')].find(
        (element) =>
          visible(element) &&
          !element.disabled &&
          element.getAttribute('aria-disabled') !== 'true' &&
          buyPattern.test(element.innerText || element.textContent || ''),
      );
      if (!control) return false;
      control.click();
      return true;
    },
    { date: targetDate, buySource: BUY_PATTERN.source },
  );
}

export async function pageNeedsManualAction(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  return CHALLENGE_PATTERN.test(text);
}

export async function detectLoginStatus(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  return inferLoginStatus(text);
}

export async function fetchLiveSessionStatus(page, config) {
  const result = await page.evaluate(
    async ({ eventId, sessionId }) => {
      const url = new URL('https://apis.ticketplus.com.tw/config/api/v1/get');
      url.searchParams.set('eventId', eventId);
      url.searchParams.set('sessionId', sessionId);
      url.searchParams.set('_', String(Date.now()));

      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'omit',
      });
      if (!response.ok) return { httpStatus: response.status, session: null };

      const payload = await response.json();
      const session = payload?.result?.session?.find((item) => item.id === sessionId) || null;
      return { httpStatus: response.status, session };
    },
    { eventId: config.internalEventId, sessionId: config.internalSessionId },
  );

  return {
    httpStatus: result.httpStatus,
    status: result.session?.status || null,
    updatedAt: result.session?.updatedAt || null,
    canBuy: isAvailableApiStatus(result.session?.status),
  };
}

async function clickSmallestTextMatch(page, pattern) {
  return page.evaluate((source) => {
    const regex = new RegExp(source, 'i');
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const candidates = [...document.querySelectorAll('button, a, label, [role="button"], td, div')]
      .filter((element) => visible(element) && regex.test((element.innerText || '').trim()))
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    const target = candidates[0];
    if (!target) return false;
    target.click();
    return true;
  }, pattern.source);
}

async function setNonAdjacentAcceptance(page, accepted) {
  const checkbox = page
    .getByRole('checkbox', { name: /接受不連位/i })
    .or(page.getByLabel(/接受不連位/i))
    .first();
  if (await checkbox.count()) {
    if (accepted) await checkbox.check().catch(() => checkbox.click());
    else await checkbox.uncheck().catch(() => {});
    return true;
  }

  if (accepted) {
    const label = page.getByText(/接受不連位/i).first();
    if (await label.count()) {
      await label.click();
      return true;
    }
  }
  return false;
}

async function clickNext(page) {
  const next = page
    .getByRole('button', { name: /下一步|確認/i })
    .or(page.getByRole('link', { name: /下一步|確認/i }))
    .first();
  if (!(await next.count())) return { clicked: false, advanced: false, seatFailure: false };

  const beforeUrl = page.url();
  const beforeText = await page.locator('body').innerText().catch(() => '');
  await next.click();
  await page.waitForTimeout(900);
  const afterText = await page.locator('body').innerText().catch(() => '');
  const advanced =
    page.url() !== beforeUrl ||
    (/確認選位結果|填寫資料|購票人資料|付款結帳/i.test(afterText) && afterText !== beforeText);

  return {
    clicked: true,
    advanced,
    seatFailure: SEAT_FAILURE_PATTERN.test(afterText),
  };
}

export async function attemptTicketSelection(page, config) {
  if (await pageNeedsManualAction(page)) {
    return { progressed: false, reason: 'challenge' };
  }

  if (config.preferredPrices.length === 0) {
    return { progressed: false, reason: 'no-price-preference' };
  }

  let selectedPrice = null;
  for (const price of config.preferredPrices) {
    const matched = await clickSmallestTextMatch(page, priceTextPattern(price));
    if (matched) {
      selectedPrice = price;
      break;
    }
  }
  if (!selectedPrice) return { progressed: false, reason: 'preferred-price-unavailable' };

  await page.waitForTimeout(250);
  let quantitySelected = false;
  const selects = page.locator('select:visible');
  for (let i = 0; i < (await selects.count()); i += 1) {
    const select = selects.nth(i);
    const option = select.locator('option').filter({ hasText: new RegExp(`^\\s*${config.ticketCount}\\s*$`) });
    if (await option.count()) {
      quantitySelected = await select
        .selectOption({ label: String(config.ticketCount) })
        .then(() => true)
        .catch(() => false);
      break;
    }
  }

  if (!quantitySelected) {
    const plus = page
      .getByRole('button', { name: /^\s*(?:\+|增加|plus)\s*$/i })
      .or(page.locator('button:visible').filter({ hasText: /^\s*\+\s*$/ }))
      .first();
    if (await plus.count()) {
      for (let i = 0; i < config.ticketCount; i += 1) await plus.click();
    }
  }

  await page.getByText(/電腦選位|電腦配位/i).first().click().catch(() => {});

  await setNonAdjacentAcceptance(page, config.seatingMode === 'any');

  if (config.acceptTerms) {
    const label = page.getByText(/已經閱讀並同意|閱讀並同意|同意.*條款/i).first();
    if (await label.count()) await label.click().catch(() => {});
  }

  if (config.autoAdvance && config.acceptTerms) {
    const firstAttempt = await clickNext(page);
    if (firstAttempt.advanced) {
      return { progressed: true, reason: 'advanced', selectedPrice };
    }

    if (config.seatingMode === 'adjacent-preferred' && firstAttempt.clicked) {
      const accepted = await setNonAdjacentAcceptance(page, true);
      if (accepted) {
        const fallbackAttempt = await clickNext(page);
        if (fallbackAttempt.advanced) {
          return { progressed: true, reason: 'advanced-non-adjacent', selectedPrice };
        }
        return {
          progressed: true,
          reason: 'non-adjacent-fallback-failed',
          selectedPrice,
        };
      }
    }

    return { progressed: true, reason: 'advance-failed', selectedPrice };
  }

  return { progressed: true, reason: 'selected-awaiting-review', selectedPrice };
}
