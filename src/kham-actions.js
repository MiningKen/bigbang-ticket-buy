const WHEELCHAIR_PATTERN = /輪椅|身障|無障礙|陪同席/i;
const OBSTRUCTED_PATTERN = /視線遮蔽|視線不良|遮蔽區|obstructed/i;
const FAN_BENEFIT_PATTERN = /粉絲福利|fan\s*benefit|vip\s*benefit/i;
const SOLD_OUT_PATTERN = /已售完|銷售一空|目前無票|暫無票券|票券已售罄|sold\s*out/i;
const CHALLENGE_PATTERN = /驗證碼|captcha|我不是機器人|正在排隊|排隊中|等候進入|waiting\s*room|you\s+are\s+(?:now\s+)?in\s+line/i;
const CARD_VALIDATION_PATTERN = /(?:信用)?卡號前\s*(?:6|六)\s*碼|信用卡前\s*(?:6|六)\s*碼|輸入.*卡號/i;
const PURCHASE_LABEL_PATTERN = /^立即訂購$/;
const REAL_NAME_NOTICE_PATTERN = /本節目採[「\s]*個人實名制入場/;
const ADJACENT_UNAVAILABLE_PATTERN = /(?:無法|不能|未能|沒有|不足|無).{0,12}(?:連號|相鄰|連續座位)|(?:連號|相鄰|連續座位).{0,12}(?:無法|不足|沒有)/i;
const ADJACENT_CONFIRMED_PATTERN = /(?:成功|已|系統).{0,16}(?:配置|分配|取得).{0,8}(?:兩張)?(?:連號|相鄰)(?:座位)?/i;

function parseKhamSeatLabels(value) {
  const text = Array.isArray(value) ? value.join('、') : String(value || '');
  return [...text.matchAll(/([^\s,，、。；;]{1,24}區)\s*(\d+)\s*排\s*(\d+)\s*號/g)].map((match) => ({
    area: match[1].replace(/\s+/g, ''),
    row: Number.parseInt(match[2], 10),
    seat: Number.parseInt(match[3], 10),
  }));
}

export function areKhamSeatsAdjacent(labels) {
  const seats = parseKhamSeatLabels(labels);
  if (seats.length !== 2) return false;
  const [left, right] = seats;
  return left.area === right.area
    && left.row === right.row
    && Math.abs(left.seat - right.seat) === 1;
}

export function classifyKhamAllocation(text, requestedCount) {
  const normalized = String(text || '');
  if (requestedCount === 1) {
    return parseKhamSeatLabels(normalized).length >= 1 ? 'single-confirmed' : 'unknown';
  }
  if (requestedCount !== 2) return 'unknown';
  if (ADJACENT_UNAVAILABLE_PATTERN.test(normalized)) return 'adjacent-unavailable';
  if (ADJACENT_CONFIRMED_PATTERN.test(normalized)) return 'confirmed';
  const seats = parseKhamSeatLabels(normalized);
  if (seats.length < 2) return 'unknown';
  return areKhamSeatsAdjacent(seats.map((seat) => `${seat.area} ${seat.row}排 ${seat.seat}號`))
    ? 'confirmed'
    : 'adjacent-unavailable';
}

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

export function rankKhamAreas(rows, config = {}) {
  return rankKhamOffers(rows, config).filter((row) => row.available === true);
}

export function classifyKhamInventory(snapshot) {
  if (snapshot.loading) return { status: 'loading', availableRows: [] };
  const availableRows = (snapshot.rows || []).filter((row) => row.available === true);
  if (availableRows.length) return { status: 'available', availableRows };
  if ((snapshot.rows || []).length) return { status: 'sold-out', availableRows: [] };
  return { status: 'unknown', availableRows: [] };
}

export async function inspectKhamInventory(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const priceFrom = (text) => {
      const explicit = text.match(/(?:NT\.?\s*)?[$＄]\s*([\d,]+)/i)
        || text.match(/(?:票價|全票|vip)\D{0,12}([\d,]{4,})/i);
      if (explicit) return Number.parseInt(explicit[1].replaceAll(',', ''), 10);
      const values = [...text.matchAll(/(?:^|\D)([\d,]{4,5})(?=\D|$)/g)]
        .map((match) => Number.parseInt(match[1].replaceAll(',', ''), 10))
        .filter((value) => value >= 2_500 && value <= 20_000);
      return values.length ? Math.max(...values) : 0;
    };
    const loadingSelectors = [
      '.blockUI',
      '.blockOverlay',
      '.loading-mask',
      '.loading-overlay',
      '.spinner-border',
      '.fa-spinner',
      '.glyphicon-refresh-animate',
      '[aria-busy="true"]',
    ].join(',');
    const loading = [...document.querySelectorAll(loadingSelectors)].some(isVisible);
    const allRows = [...document.querySelectorAll('tr')];
    const rows = allRows.flatMap((row, domIndex) => {
      if (!isVisible(row)) return [];
      const text = clean(row.innerText || row.textContent);
      const price = priceFrom(text);
      if (!price) return [];
      const soldOut = /已售完|銷售一空|目前無票|票券已售罄|sold\s*out/i.test(text);
      const controls = [...row.querySelectorAll('a, button, select, input, [onclick]')]
        .filter((element) => isVisible(element) && !element.disabled);
      const rowClickable = row.hasAttribute('onclick') || controls.length > 0;
      return [{
        index: domIndex,
        text,
        price,
        available: !soldOut && rowClickable,
      }];
    });
    return { loading, rows };
  });
}

export async function waitForKhamInventory(page, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await inspectKhamInventory(page);
  while (snapshot.loading && Date.now() < deadline) {
    await page.waitForTimeout(100);
    snapshot = await inspectKhamInventory(page);
  }
  return snapshot;
}

export async function refreshKhamInventory(page) {
  const control = page
    .getByRole('button', { name: /更新票數/ })
    .or(page.getByRole('link', { name: /更新票數/ }))
    .first();
  if (!(await control.count())) return false;
  if (!(await control.isVisible().catch(() => false))) return false;
  if (!(await control.isEnabled().catch(() => false))) return false;
  await control.click();
  return true;
}

export async function selectBestKhamArea(page, snapshot, config = {}) {
  const area = rankKhamAreas(snapshot.rows || [], config)[0];
  if (!area) return { selected: false, reason: 'no-compatible-area' };
  const row = page.locator('tr').nth(area.index);
  const control = row.locator('a, button, select, input:not([type="hidden"]), [onclick]').first();
  if (await control.count()) {
    const tagName = await control.evaluate((element) => element.tagName).catch(() => '');
    if (tagName === 'SELECT') return { selected: false, reason: 'quantity-unavailable' };
    await control.click();
  }
  else await row.click();
  return { selected: true, area };
}

export async function selectKhamQuantity(page, ticketCount) {
  if (![1, 2].includes(ticketCount)) throw new Error('寬宏票數只能選擇 1 或 2 張');
  const target = await page.evaluate((count) => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const selects = [...document.querySelectorAll('select')];
    for (let index = 0; index < selects.length; index += 1) {
      const select = selects[index];
      if (!visible(select) || select.disabled) continue;
      const option = [...select.options].find((candidate) => {
        if (candidate.disabled) return false;
        const value = String(candidate.value || '').trim();
        const label = String(candidate.textContent || '').trim();
        return value === String(count) || new RegExp(`^${count}(?:\\s*張)?$`).test(label);
      });
      if (option) return { kind: 'select', index, value: option.value };
    }
    return null;
  }, ticketCount);

  if (!target) return false;
  await page.locator('select').nth(target.index).selectOption(target.value);
  return true;
}

export async function pageText(page) {
  return page.locator('body').innerText().catch(() => '');
}

export async function inspectKhamPage(page) {
  const structure = await page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1_000);
    const dialogSelectors = [
      '[role="dialog"]',
      '.ui-dialog',
      '.modal',
      '.swal2-popup',
      '.bootbox',
      '[class*="popup"]',
      '[id*="popup"]',
    ].join(',');
    const dialogs = [...document.querySelectorAll(dialogSelectors)]
      .filter(isVisible)
      .map((element) => ({
        text: clean(element.innerText || element.textContent),
        controls: [...element.querySelectorAll('button, input[type="button"], input[type="submit"], a')]
          .filter(isVisible)
          .map((control) => clean(control.innerText || control.value || control.textContent))
          .filter(Boolean)
          .slice(0, 20),
      }))
      .filter((dialog) => dialog.text);
    const visibleInputs = [...document.querySelectorAll('input:not([type="hidden"]), select')]
      .filter(isVisible)
      .map((element) => ({
        type: element.tagName === 'SELECT' ? 'select' : (element.type || 'text'),
        name: clean(element.name),
        id: clean(element.id),
        placeholder: clean(element.placeholder),
      }));
    return { dialogs, visibleInputs };
  });

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    ...structure,
  };
}

export async function dismissKhamRealNameNotice(page) {
  const dialogs = page.locator([
    '[role="dialog"]',
    '.ui-dialog',
    '.modal',
    '.swal2-popup',
    '.bootbox',
    '[class*="popup"]',
    '[id*="popup"]',
  ].join(','));

  for (let index = 0; index < await dialogs.count(); index += 1) {
    const dialog = dialogs.nth(index);
    if (!(await dialog.isVisible().catch(() => false))) continue;
    const text = await dialog.innerText().catch(() => '');
    if (!REAL_NAME_NOTICE_PATTERN.test(text)) continue;

    const confirm = dialog
      .getByRole('button', { name: /^(?:Ok|確定)$/i })
      .or(dialog.getByRole('link', { name: /^(?:Ok|確定)$/i }))
      .first();
    if (!(await confirm.count())) return false;
    if (!(await confirm.isVisible().catch(() => false))) return false;
    if (!(await confirm.isEnabled().catch(() => false))) return false;
    await confirm.click();
    return true;
  }

  return false;
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

export async function clickBestKhamPurchaseOption(page, config, optionRank = 0) {
  const options = rankKhamOffers(await scanKhamPurchaseOptions(page), config);
  const option = options[optionRank];
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
