import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { chromium } from 'playwright-core';

import { pageForExistingContext } from './browser-session.js';
import {
  classifyKhamAllocation,
  classifyKhamInventory,
  classifyKhamPage,
  clickBestKhamPurchaseOption,
  clickKhamBuy,
  clickKhamNext,
  dismissKhamRealNameNotice,
  fillKhamCardPrefix,
  hasKhamCardValidation,
  inspectKhamPage,
  refreshKhamInventory,
  normalizeKhamCardPrefix,
  pageText,
  selectKhamOffer,
  selectBestKhamArea,
  selectKhamQuantity,
  selectKhamVipBenefit,
  submitKhamCardValidation,
  waitForKhamInventory,
} from './kham-actions.js';
import { readKhamConfig } from './kham-config.js';
import { buildKhamAttemptPlan, KHAM_TICKET_MODES, nextKhamRefreshDelay } from './kham-strategy.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ACTION_DISCOVERY_TIMEOUT_MS = 15_000;
const KHAM_HOST_PATTERN = /(?:^|\.)kham\.com\.tw$/i;

export class KhamController {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
    this.envPath = `${cwd}/.kham.env`;
    this.context = null;
    this.page = null;
    this.cardPrefix = null;
    this.ticketModeOverride = null;
    this.stopRequested = false;
    this.restriction = null;
    this.configuredPages = new WeakSet();
    this.state = {
      running: false,
      browserOpen: false,
      loginStatus: 'unknown',
      ticketStatus: 'not-started',
      phase: 'idle',
      message: '尚未啟動',
      logs: [],
      alertId: 0,
      alertMessage: null,
    };
  }

  getConfig() {
    const fileEnv = existsSync(this.envPath) ? parseEnv(readFileSync(this.envPath, 'utf8')) : {};
    const config = readKhamConfig({ ...process.env, ...fileEnv }, this.cwd);
    if (!this.ticketModeOverride) return config;
    return {
      ...config,
      ticketMode: this.ticketModeOverride,
      ticketCount: this.ticketModeOverride === 'adjacent-two-then-one' ? 2 : 1,
    };
  }

  publicState() {
    const config = this.getConfig();
    return {
      ...this.state,
      cardPrefixReady: this.cardPrefix !== null,
      config: {
        primary: config.primary.label,
        fallback: config.fallback.label,
        saleStart: config.saleStart.toISOString(),
        saleMode: config.saleMode,
        ticketMode: config.ticketMode,
        ticketCount: config.ticketCount,
        wantVipBenefit: config.wantVipBenefit,
        autoAdvance: config.autoAdvance,
      },
    };
  }

  setCardPrefix(value) {
    this.cardPrefix = normalizeKhamCardPrefix(value);
    this.log('已在記憶體暫存中信卡號前 6 碼；關閉程式後會自動清除');
    return this.publicState();
  }

  setTicketMode(value) {
    if (this.state.running) throw new Error('搶票執行中不能變更票數模式；請先停止');
    if (!KHAM_TICKET_MODES.has(value)) throw new Error('票數模式只能選擇單張或兩張連號優先');
    this.ticketModeOverride = value;
    this.log(value === 'single'
      ? '票數模式已設為 1 張'
      : '票數模式已設為 2 張連號優先；兩個日期都無連號時降為 1 張');
    return this.publicState();
  }

  log(message) {
    const entry = { at: new Date().toISOString(), message };
    this.state.logs = [entry, ...this.state.logs].slice(0, 40);
    this.state.message = message;
    console.log(`[${new Date().toLocaleTimeString('zh-TW', { hour12: false })}] ${message}`);
  }

  alert(message) {
    process.stdout.write('\u0007\u0007\u0007');
    this.state.alertId += 1;
    this.state.alertMessage = message;
    this.log(message);
    void this.page?.bringToFront().catch(() => {});
  }

  async recordDiagnostic(label, config, { screenshot = false } = {}) {
    const evidence = await inspectKhamPage(this.page).catch((error) => ({ error: error.message }));
    this.log(`診斷［${label}］：${JSON.stringify(evidence)}`);
    if (screenshot && !await hasKhamCardValidation(this.page).catch(() => false)) {
      const safeLabel = label.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]+/g, '-');
      await this.page.screenshot({
        path: `${config.artifactsDir}/kham-diagnostic-${Date.now()}-${safeLabel}.png`,
        fullPage: true,
      }).catch(() => {});
    }
    return evidence;
  }

  async ensureBrowser() {
    if (this.context && this.page && !this.page.isClosed()) return this.page;

    const config = this.getConfig();
    if (!config.chromePath || !existsSync(config.chromePath)) {
      throw new Error('找不到 Chrome 或 Edge，請先安裝其中一個瀏覽器，或設定 CHROME_PATH');
    }
    mkdirSync(config.artifactsDir, { recursive: true });

    if (this.context) {
      try {
        this.page = await pageForExistingContext(this.context, this.page);
        this.configurePage(this.page);
        await this.page.goto(config.primary.url, { waitUntil: 'domcontentloaded' });
        this.state.browserOpen = true;
        await this.refreshLoginStatus();
        this.log('已重新使用既有的寬宏 Chrome 分頁');
        return this.page;
      } catch (error) {
        if (!/Target page, context or browser has been closed/i.test(error.message)) throw error;
        this.context = null;
        this.page = null;
      }
    }

    this.log('正在開啟寬宏購票 Chrome…');
    this.context = await chromium.launchPersistentContext(config.profileDir, {
      executablePath: config.chromePath,
      headless: false,
      viewport: null,
    });
    this.page = await pageForExistingContext(this.context, this.page);
    this.configurePage(this.page);
    this.context.on('close', () => {
      this.context = null;
      this.page = null;
      this.state.browserOpen = false;
      this.state.loginStatus = 'unknown';
      this.stop();
    });

    await this.page.goto(config.primary.url, { waitUntil: 'domcontentloaded' });
    this.state.browserOpen = true;
    await this.refreshLoginStatus();
    this.log('寬宏購票 Chrome 已開啟');
    return this.page;
  }

  configurePage(page) {
    if (this.configuredPages.has(page)) return;
    this.configuredPages.add(page);
    page.setDefaultTimeout(3_000);
    page.on('response', (response) => {
      let url;
      try {
        url = new URL(response.url());
      } catch {
        return;
      }
      if (!KHAM_HOST_PATTERN.test(url.hostname)) return;
      if (![403, 429].includes(response.status())) return;
      this.restriction = response.status();
      this.log(`寬宏回應 HTTP ${response.status()}，已停止自動操作以避免觸發限制`);
    });
    page.once('close', () => {
      if (this.page !== page) return;
      this.page = null;
      this.state.loginStatus = 'unknown';
      if (this.state.running) {
        this.stopRequested = true;
        this.log('寬宏購票分頁已關閉，監看已停止');
      }
    });
  }

  async refreshLoginStatus() {
    if (!this.page || this.page.isClosed()) {
      this.state.loginStatus = 'unknown';
      return this.state.loginStatus;
    }
    const text = await pageText(this.page);
    this.state.loginStatus = /登出|會員專區/.test(text) && !/^會員登入$/m.test(text) ? 'logged-in' : 'unknown';
    return this.state.loginStatus;
  }

  async openLogin() {
    const page = await this.ensureBrowser();
    await page.bringToFront();
    await this.refreshLoginStatus();
    this.log('請在寬宏 Chrome 自行完成會員登入與實名制名單確認');
    return this.publicState();
  }

  stop() {
    this.stopRequested = true;
    if (this.state.running) this.log('正在停止…');
  }

  async waitForSaleStart(config) {
    const delay = config.saleStart.valueOf() - Date.now();
    if (delay <= 0) return;

    this.state.phase = 'waiting-sale';
    const label = config.saleMode === 'ctbc-rehearsal' ? '中信卡友優先購' : '一般販售';
    this.log(`等待${label}：${config.saleStart.toLocaleString('zh-TW', { hour12: false })}`);
    while (!this.stopRequested && Date.now() < config.saleStart.valueOf()) {
      await sleep(Math.min(1_000, config.saleStart.valueOf() - Date.now()));
    }
  }

  async waitBeforeNextAttempt() {
    const delay = nextKhamRefreshDelay();
    this.state.phase = 'refresh-wait';
    this.log(`等待 ${(delay / 1_000).toFixed(1)} 秒後更新票數`);
    const deadline = Date.now() + delay;
    while (!this.stopRequested && Date.now() < deadline) {
      await sleep(Math.min(250, deadline - Date.now()));
    }
    return !this.stopRequested;
  }

  async enterSale(product) {
    const page = this.page;
    await page.goto(product.url, { waitUntil: 'domcontentloaded' });
    let noticeDismissed = false;

    for (let attempt = 0; attempt < 10 && !this.stopRequested; attempt += 1) {
      if (await dismissKhamRealNameNotice(page).catch(() => false)) {
        noticeDismissed = true;
        this.log('已確認官方個人實名制提示，繼續進入購票流程');
        await sleep(100);
      }
      if (await clickKhamBuy(page).catch(() => false)) return true;
      await sleep(500);
      if (attempt === 2 || attempt === 5 || attempt === 8) {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }

    if (noticeDismissed) this.log('已關閉實名制提示，但仍找不到可用的官方購票按鈕');

    return false;
  }

  async waitForAttemptInventory(config) {
    const page = this.page;
    const deadline = Date.now() + ACTION_DISCOVERY_TIMEOUT_MS;
    let cardSubmittedAt = null;

    while (!this.stopRequested && Date.now() < deadline) {
      if (this.restriction) return { reason: 'blocked' };
      if (await dismissKhamRealNameNotice(page).catch(() => false)) {
        this.log('已確認官方個人實名制提示，繼續等待票況');
        await sleep(100);
        continue;
      }
      const text = await pageText(page);
      if (classifyKhamPage(text) === 'challenge') {
        this.alert('偵測到寬宏排隊或驗證畫面，已停止自動操作；請在寬宏 Chrome 手動完成');
        return { reason: 'blocked' };
      }

      if (await hasKhamCardValidation(page)) {
        if (config.saleMode !== 'ctbc-rehearsal') {
          this.alert('一般販售流程出現非預期的信用卡驗證視窗，已停止自動操作');
          return { reason: 'blocked' };
        }
        if (!this.cardPrefix) {
          this.alert('請先在控制面板暫存中信卡號前 6 碼');
          return { reason: 'blocked' };
        }
        if (!cardSubmittedAt) {
          await this.recordDiagnostic('偵測到六碼視窗（填寫前）', config);
          const filled = await fillKhamCardPrefix(page, this.cardPrefix).catch(() => false);
          const submitted = filled && await submitKhamCardValidation(page).catch(() => false);
          if (!submitted) {
            this.alert('無法安全送出卡友驗證，已停止自動操作；請手動檢查');
            return { reason: 'blocked' };
          }
          cardSubmittedAt = Date.now();
          this.log('已自動填入中信卡號前 6 碼並送出卡友驗證');
          await sleep(500);
          continue;
        }
        if (Date.now() - cardSubmittedAt >= 3_000) {
          this.alert('卡友驗證視窗仍未關閉，已停止自動操作；請手動檢查驗證結果');
          return { reason: 'blocked' };
        }
        await sleep(200);
        continue;
      }

      const snapshot = await waitForKhamInventory(page, 1_000).catch(() => null);
      if (snapshot) {
        const inventory = classifyKhamInventory(snapshot);
        if (inventory.status !== 'unknown' && inventory.status !== 'loading') {
          return { reason: 'inventory', snapshot, inventory };
        }
      }

      const evidence = await inspectKhamPage(page).catch(() => null);
      if (evidence?.dialogs?.length) {
        await this.recordDiagnostic('未知訊息視窗', config, { screenshot: true });
        this.alert('偵測到未識別的寬宏訊息視窗，已停止自動操作；請手動檢查');
        return { reason: 'blocked' };
      }
      await sleep(200);
    }

    if (this.stopRequested) return { reason: 'stopped' };
    await this.recordDiagnostic('票況頁逾時', config, { screenshot: true });
    this.alert('無法確認寬宏票況頁狀態，已停止自動操作；請手動檢查');
    return { reason: 'blocked' };
  }

  async selectAttemptInventory(attempt, config, snapshot) {
    const page = this.page;
    const attemptConfig = { ...config, ticketCount: attempt.ticketCount };
    let selected = await selectKhamOffer(page, attemptConfig).catch(() => ({ selected: false }));
    let quantityConfirmed = selected.selected && selected.offer.kind === 'select';

    if (!selected.selected) {
      const area = await selectBestKhamArea(page, snapshot, attemptConfig).catch(() => ({ selected: false }));
      if (!area.selected) return { reason: 'unavailable' };
      await sleep(200);
      quantityConfirmed = await selectKhamQuantity(page, attempt.ticketCount).catch(() => false);
      selected = { selected: quantityConfirmed, offer: area.area };
    } else if (!quantityConfirmed) {
      quantityConfirmed = await selectKhamQuantity(page, attempt.ticketCount).catch(() => false);
    }

    if (!selected.selected || !quantityConfirmed) {
      this.alert(`無法確認已選擇正確的 ${attempt.ticketCount} 張票，已停止自動操作`);
      return { reason: 'blocked' };
    }

    this.state.phase = 'selecting';
    this.state.ticketStatus = `已選 ${attempt.ticketCount} 張：${selected.offer.text}`;
    this.log(`已選擇 ${attempt.ticketCount} 張：${selected.offer.text}`);
    if (config.wantVipBenefit && /VIP/i.test(selected.offer.text || '')) {
      const benefitSelected = await selectKhamVipBenefit(page).catch(() => false);
      this.log(benefitSelected ? '已嘗試加選 VIP 粉絲福利' : '本票種未偵測到可加選的 VIP 粉絲福利');
    }
    if (!config.autoAdvance) {
      this.alert('已完成票數選擇；自動下一步未開啟，請立即手動接手');
      return { reason: 'blocked' };
    }

    const advanced = await clickKhamNext(page).catch(() => false);
    if (!advanced) {
      this.alert('找不到安全的下一步按鈕，已停止自動操作；請立即手動接手');
      return { reason: 'blocked' };
    }
    const resultText = await pageText(page);
    if (attempt.adjacencyRequired) {
      const allocation = classifyKhamAllocation(resultText, 2);
      if (allocation === 'adjacent-unavailable') {
        this.log(`${attempt.product.date} 無法配置兩張連號，繼續下一順位`);
        return { reason: 'adjacent-unavailable' };
      }
      if (allocation !== 'confirmed') {
        await this.recordDiagnostic('無法確認連號配置', config, { screenshot: true });
        this.alert('已進入下一步，但無法證明兩張座位連號；為避免誤買已停止自動操作');
        return { reason: 'blocked' };
      }
    }

    this.state.phase = 'manual-action';
    await page.screenshot({ path: `${config.artifactsDir}/kham-ticket-selected-${Date.now()}.png`, fullPage: true }).catch(() => {});
    this.alert(`已確認 ${attempt.ticketCount} 張符合條件的票並停在下一步；請立即完成實名資料與付款`);
    return { reason: 'selected' };
  }

  async runAttempt(attempt, config) {
    const page = this.page;
    const attemptConfig = { ...config, ticketCount: attempt.ticketCount };
    for (let offerRank = 0; offerRank < 20 && !this.stopRequested; offerRank += 1) {
      this.state.phase = 'entering-sale';
      this.log(`嘗試 ${attempt.product.label}，${attempt.ticketCount} 張${attempt.adjacencyRequired ? '連號' : ''}`);
      if (!(await this.enterSale(attempt.product))) {
        await this.recordDiagnostic('找不到官方購票按鈕', config, { screenshot: true });
        return { reason: 'blocked' };
      }

      const purchase = await clickBestKhamPurchaseOption(page, attemptConfig, offerRank)
        .catch(() => ({ clicked: false }));
      if (!purchase.clicked) return { reason: 'unavailable' };
      this.state.ticketStatus = `嘗試 ${purchase.option.price} 元／${attempt.ticketCount} 張`;
      this.log(`已依順位點擊「立即訂購」：${purchase.option.text}`);

      let stage = await this.waitForAttemptInventory(config);
      if (stage.reason !== 'inventory') return stage;
      if (config.saleMode === 'ctbc-rehearsal') {
        this.alert('中信演練已抵達票況頁，依安全限制停止；未選票、未保留座位');
        return { reason: 'blocked' };
      }
      if (stage.inventory.status === 'available') {
        const result = await this.selectAttemptInventory(attempt, config, stage.snapshot);
        if (result.reason !== 'unavailable') return result;
      }

      if (!(await this.waitBeforeNextAttempt())) return { reason: 'stopped' };
      this.state.phase = 'refreshing';
      if (await refreshKhamInventory(page).catch(() => false)) {
        this.log('已按寬宏「更新票數」，等待票況穩定');
        const refreshed = await waitForKhamInventory(page, 15_000).catch(() => null);
        if (!refreshed || refreshed.loading) {
          this.alert('更新票數後仍無法確認票況，已停止自動操作');
          return { reason: 'blocked' };
        }
        const inventory = classifyKhamInventory(refreshed);
        if (inventory.status === 'available') {
          const result = await this.selectAttemptInventory(attempt, config, refreshed);
          if (result.reason !== 'unavailable') return result;
        } else if (inventory.status === 'unknown') {
          this.alert('更新票數後頁面結構無法辨識，已停止自動操作');
          return { reason: 'blocked' };
        }
      }
    }
    return { reason: this.stopRequested ? 'stopped' : 'unavailable' };
  }

  async start() {
    if (this.state.running) return;
    this.stopRequested = false;
    this.restriction = null;
    this.state.running = true;
    this.state.phase = 'starting';

    try {
      const config = this.getConfig();
      if (config.saleMode === 'ctbc-rehearsal' && !this.cardPrefix) {
        throw new Error('中信卡友演練模式必須先在控制面板安全暫存卡號前 6 碼');
      }
      await this.ensureBrowser();
      await this.refreshLoginStatus();
      if (this.state.loginStatus !== 'logged-in') {
        this.log('警告：無法確認寬宏登入狀態，請立即在購票 Chrome 檢查會員是否仍已登入');
      }
      await this.waitForSaleStart(config);
      if (this.stopRequested) return;

      const plan = buildKhamAttemptPlan(config.ticketMode, config.primary, config.fallback);
      while (!this.stopRequested) {
        for (const attempt of plan) {
          if (this.stopRequested) break;
          const result = await this.runAttempt(attempt, config);
          if (result.reason === 'selected') return;
          if (result.reason === 'blocked') {
            this.state.phase = 'blocked';
            return;
          }
          if (result.reason === 'stopped') return;
          this.log(`${attempt.product.date}／${attempt.ticketCount} 張目前無符合條件票券，繼續下一順位`);
        }
        if (!this.stopRequested) this.log('本輪所有順位皆無票，從 2/28 重新開始');
      }
    } catch (error) {
      this.state.phase = 'error';
      this.log(`錯誤：${error.message}`);
    } finally {
      this.state.running = false;
      if (this.stopRequested) {
        this.state.phase = 'idle';
        this.log('已停止');
      }
    }
  }

  async close() {
    this.stop();
    if (this.context) await this.context.close().catch(() => {});
  }
}
