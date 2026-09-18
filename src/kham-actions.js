const WHEELCHAIR_PATTERN = /輪椅|身障|無障礙|陪同席/i;
const OBSTRUCTED_PATTERN = /視線遮蔽|視線不良|遮蔽區|obstructed/i;
const FAN_BENEFIT_PATTERN = /粉絲福利|fan\s*benefit|vip\s*benefit/i;
const SOLD_OUT_PATTERN = /已售完|銷售一空|目前無票|暫無票券|票券已售罄|sold\s*out/i;
const CHALLENGE_PATTERN = /驗證碼|captcha|我不是機器人|排隊中|queue/i;
const CARD_VALIDATION_PATTERN = /卡號前\s*6\s*碼|信用卡前\s*6\s*碼|輸入.*卡號/i;

export function rankKhamOffers(offers, { preferNonObstructed = true, allowObstructedFallback = true } = {}) {
  return offers
    .filter((offer) => offer.enabled !== false)
    .filter((offer) => !WHEELCHAIR_PATTERN.test(offer.text || ''))
    .filter((offer) => !FAN_BENEFIT_PATTERN.test(offer.text || ''))
    .filter((offer) => allowObstructedFallback || !OBSTRUCTED_PATTERN.test(offer.text || ''))
    .sort((left, right) => {
      if (preferNonObstructed) {
        const leftObstructed = OBSTRUCTED_PATTERN.test(left.text || '');
        const rightObstructed = OBSTRUCTED_PATTERN.test(right.text || '');
        if (leftObstructed !== rightObstructed) return Number(leftObstructed) - Number(rightObstructed);
      }
      return (right.price || 0) - (left.price || 0);
    });
}

export async function pageText(page) {
  return page.locator('body').innerText().catch(() => '');
}

export function classifyKhamPage(text) {
  if (CHALLENGE_PATTERN.test(text)) return 'challenge';
  if (SOLD_OUT_PATTERN.test(text)) return 'sold-out';
  return 'unknown';
}

export async function hasKhamCardValidation(page) {
  return page.evaluate((patternSource) => {
    const pattern = new RegExp(patternSource, 'i');
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll('input:not([type="hidden"])')].some((input) => {
      if (!visible(input)) return false;
      const surroundingText = input.closest('form, div, td, li')?.innerText || '';
      return pattern.test(`${input.placeholder || ''} ${input.getAttribute('aria-label') || ''} ${surroundingText}`);
    });
  }, CARD_VALIDATION_PATTERN.source);
}

export async function clickKhamBuy(page) {
  const button = page.locator('#GO_BUY, #GO_BUY2').first();
  if (await button.count()) {
    await button.click();
    return true;
  }

  const textButton = page.getByRole('button', { name: /我要購票|立即購票/i }).first();
  if (!(await textButton.count())) return false;
  await textButton.click();
  return true;
}

export async function scanKhamOffers(page, ticketCount) {
  return page.evaluate((count) => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const priceFrom = (text) => {
      const match = text.match(/(?:NT\.?\s*)?[$＄]\s*([\d,]+)/i) || text.match(/(?:票價|全票|vip)\D{0,12}([\d,]{4,})/i);
      return match ? Number.parseInt(match[1].replaceAll(',', ''), 10) : 0;
    };
    const surroundingText = (element) => {
      const container = element.closest('tr, li, .ticket, .area, .price, div') || element.parentElement;
      return (container?.innerText || element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const offers = [];

    [...document.querySelectorAll('select')].forEach((select, index) => {
      if (!isVisible(select) || select.disabled) return;
      const option = [...select.options].find((item) => !item.disabled && /(?:^|\D)1(?:\D|$)/.test(item.textContent || ''));
      const text = surroundingText(select);
      const price = priceFrom(text);
      if (option && price) {
        offers.push({ kind: 'select', index, optionValue: option.value, text, price, enabled: true });
      }
    });

    [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')].forEach((input, index) => {
      if (!isVisible(input) || input.disabled) return;
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      const text = `${label?.innerText || ''} ${surroundingText(input)}`.replace(/\s+/g, ' ').trim();
      const price = priceFrom(text);
      if (price) offers.push({ kind: 'input', index, text, price, enabled: true });
    });

    return offers;
  }, ticketCount);
}

export async function selectKhamOffer(page, config) {
  const offers = rankKhamOffers(await scanKhamOffers(page, config.ticketCount), config);
  const offer = offers[0];
  if (!offer) return { selected: false, reason: 'no-compatible-offer' };

  if (offer.kind === 'select') {
    const select = page.locator('select').nth(offer.index);
    await select.selectOption(offer.optionValue);
  } else {
    const input = page.locator('input[type="radio"], input[type="checkbox"]').nth(offer.index);
    await input.check().catch(() => input.click());
  }

  return { selected: true, offer };
}

export async function selectKhamVipBenefit(page) {
  return page.evaluate((patternSource) => {
    const pattern = new RegExp(patternSource, 'i');
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const label = [...document.querySelectorAll('label, button, a, div, span')].find(
      (element) => visible(element) && pattern.test(element.innerText || element.textContent || ''),
    );
    if (!label) return false;
    const input = label.matches('label') && label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input');
    if (input && input instanceof HTMLInputElement && input.checked) return true;
    label.click();
    return true;
  }, FAN_BENEFIT_PATTERN.source);
}

export async function clickKhamNext(page) {
  const button = page
    .getByRole('button', { name: /^(?:下一步|確認票種|確認選位|確認)$/i })
    .or(page.getByRole('link', { name: /^(?:下一步|確認票種|確認選位|確認)$/i }))
    .first();
  if (!(await button.count())) return false;
  await button.click();
  return true;
}
