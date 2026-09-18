const WHEELCHAIR_PATTERN = /輪椅|身障|無障礙|陪同席/i;
const OBSTRUCTED_PATTERN = /視線遮蔽|視線不良|遮蔽區|obstructed/i;
const FAN_BENEFIT_PATTERN = /粉絲福利|fan\s*benefit|vip\s*benefit/i;
const SOLD_OUT_PATTERN = /已售完|銷售一空|目前無票|暫無票券|票券已售罄|sold\s*out/i;
const CHALLENGE_PATTERN = /驗證碼|captcha|我不是機器人|正在排隊|排隊中|等候進入|waiting\s*room|you\s+are\s+(?:now\s+)?in\s+line/i;
const CARD_VALIDATION_PATTERN = /(?:信用)?卡號前\s*(?:6|六)\s*碼|信用卡前\s*(?:6|六)\s*碼|輸入.*卡號/i;
const PURCHASE_LABEL_PATTERN = /^立即訂購$/;

export function priceFromKhamText(text) {
  const explicit = String(text || '').match(/(?:NT\.?\s*)?[$＄]\s*([\d,]+)/i)
    || String(text || '').match(/(?:票價|全票|vip)\D{0,12}([\d,]{4,})/i);
  if (explicit) return Number.parseInt(explicit[1].replaceAll(',', ''), 10);

  const candidates = [...String(text || '').matchAll(/(?:^|\D)([\d,]{4,5})(?=\D|$)/g)]
    .map((match) => Number.parseInt(match[1].replaceAll(',', ''), 10))
    .filter((value) => value >= 2_500 && value <= 20_000);
  return candidates.length ? Math.max(...candidates) : 0;
}

export function normalizeKhamCardPrefix(value) {
  const prefix = String(value ?? '').trim();
  if (!/^\d{6}$/.test(prefix)) throw new Error('中信卡號前 6 碼必須是剛好 6 位數字');
  return prefix;
}

async function cardValidationInput(page) {
  const inputs = page.locator('input:not([type="hidden"])');
  const count = await inputs.count();

  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if (!(await input.isVisible().catch(() => false))) continue;
    const description = await input.evaluate((element) => {
      const surroundingText = element.closest('form, div, td, li')?.innerText || '';
      return `${element.placeholder || ''} ${element.getAttribute('aria-label') || ''} ${surroundingText}`;
    }).catch(() => '');
    if (CARD_VALIDATION_PATTERN.test(description)) return input;
  }

  return null;
}

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
  return Boolean(await cardValidationInput(page));
}

export async function fillKhamCardPrefix(page, value) {
  const prefix = normalizeKhamCardPrefix(value);
  const input = await cardValidationInput(page);
  if (!input) return false;
  await input.fill(prefix);
  return true;
}

export async function submitKhamCardValidation(page) {
  const exactSubmit = page
    .getByRole('button', { name: '送出', exact: true })
    .or(page.getByRole('link', { name: '送出', exact: true }))
    .first();
  if (await exactSubmit.count()
      && await exactSubmit.isVisible().catch(() => false)
      && await exactSubmit.isEnabled().catch(() => false)) {
    await exactSubmit.click();
    return true;
  }

  const fallback = page
    .getByRole('button', { name: /^(?:驗證|確定|確認)$/ })
    .or(page.getByRole('link', { name: /^(?:驗證|確定|確認)$/ }))
    .first();
  if (!(await fallback.count())) return false;
  if (!(await fallback.isVisible().catch(() => false))) return false;
  if (!(await fallback.isEnabled().catch(() => false))) return false;
  await fallback.click();
  return true;
}

export async function clickKhamBuy(page) {
  const button = page.locator('#GO_BUY, #GO_BUY2').first();
  if (await button.count()
      && await button.isVisible().catch(() => false)
      && await button.isEnabled().catch(() => false)) {
    await button.click();
    return true;
  }

  const textButton = page
    .getByRole('button', { name: /^(?:我要購票|立即購票)$/i })
    .or(page.getByRole('link', { name: /^(?:我要購票|立即購票)$/i }))
    .first();
  if (!(await textButton.count())) return false;
  if (!(await textButton.isVisible().catch(() => false))) return false;
  if (!(await textButton.isEnabled().catch(() => false))) return false;
  await textButton.click();
  return true;
}

export async function scanKhamPurchaseOptions(page) {
  const controls = page
    .getByRole('button', { name: PURCHASE_LABEL_PATTERN })
    .or(page.getByRole('link', { name: PURCHASE_LABEL_PATTERN }));
  const options = [];

  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible().catch(() => false))) continue;
    if (!(await control.isEnabled().catch(() => false))) continue;
    const text = await control.evaluate((element) => {
      const container = element.closest('tr, li, .ticket, .product, .item, .row, div') || element.parentElement;
      return (container?.innerText || element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    }).catch(() => '');
    const price = priceFromKhamText(text);
    if (price) options.push({ control, text, price, enabled: true });
  }

  return options;
}

export async function clickBestKhamPurchaseOption(page, config) {
  const options = rankKhamOffers(await scanKhamPurchaseOptions(page), config);
  const option = options[0];
  if (!option) return { clicked: false, reason: 'no-purchase-option' };
  await option.control.click();
  return { clicked: true, option: { text: option.text, price: option.price } };
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
      const option = [...select.options].find((item) => {
        if (item.disabled) return false;
        const escapedCount = String(count).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|\\D)${escapedCount}(?:\\D|$)`).test(item.textContent || '');
      });
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
    const input = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')].find((element) => {
      if (!visible(element) || element.disabled) return false;
      const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
      const container = element.closest('label, tr, li, .option, .benefit, div');
      return pattern.test(`${label?.innerText || ''} ${container?.innerText || ''}`);
    });
    if (!input) return false;
    if (input.checked) return true;
    input.click();
    return true;
  }, FAN_BENEFIT_PATTERN.source);
}

export async function clickKhamNext(page) {
  const button = page
    .getByRole('button', { name: /^(?:下一步|確認票種|確認選位|確認)$/i })
    .or(page.getByRole('link', { name: /^(?:下一步|確認票種|確認選位|確認)$/i }))
    .first();
  if (!(await button.count())) return false;
  if (!(await button.isVisible().catch(() => false))) return false;
  if (!(await button.isEnabled().catch(() => false))) return false;
  const beforeUrl = page.url();
  const beforeText = await pageText(page);
  await button.click();
  await page.waitForTimeout(500);
  const afterText = await pageText(page);
  return page.url() !== beforeUrl || afterText !== beforeText;
}
