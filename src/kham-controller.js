import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { chromium } from 'playwright-core';

import { pageForExistingContext } from './browser-session.js';
import {
  classifyKhamPage,
  clickKhamBuy,
  clickKhamNext,
  hasKhamCardValidation,
  pageText,
  selectKhamOffer,
  selectKhamVipBenefit,
} from './kham-actions.js';
import { readKhamConfig } from './kham-config.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class KhamController {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
    this.envPath = `${cwd}/.kham.env`;
    this.context = null;
    this.page = null;
    this.stopRequested = false;
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
    return readKhamConfig({ ...process.env, ...fileEnv }, this.cwd);
  }

  publicState() {
    const config = this.getConfig();
    return {
      ...this.state,
      config: {
        primary: config.primary.label,
        fallback: config.fallback.label,
        saleStart: config.saleStart.toISOString(),
        ticketCount: config.ticketCount,
        wantVipBenefit: config.wantVipBenefit,
        autoAdvance: config.autoAdvance,
      },
    };
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
    page.setDefaultTimeout(3_000);
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
    this.log(`等待中信卡友優先購：${config.saleStart.toLocaleString('zh-TW', { hour12: false })}`);
    while (!this.stopRequested && Date.now() < config.saleStart.valueOf()) {
      await sleep(Math.min(1_000, config.saleStart.valueOf() - Date.now()));
    }
  }

  async runProduct(product, config) {
    const page = this.page;
    this.state.phase = 'entering-sale';
    this.log(`前往 ${product.label}`);
    await page.goto(product.url, { waitUntil: 'domcontentloaded' });

    if (!(await clickKhamBuy(page))) {
      return { reason: 'buy-button-not-found' };
    }
    this.log(`已點擊 ${product.date} 官方購票按鈕`);

    let cardPrompted = false;
    let challengePrompted = false;
    const deadline = Date.now() + 20 * 60_000;
    while (!this.stopRequested && Date.now() < deadline) {
      const text = await pageText(page);
      const stage = classifyKhamPage(text);

      if (stage === 'challenge') {
        this.state.phase = 'manual-action';
        if (!challengePrompted) {
          challengePrompted = true;
          this.alert('偵測到寬宏排隊或驗證畫面，請在寬宏 Chrome 手動完成');
        }
        await sleep(800);
        continue;
      }

      if (await hasKhamCardValidation(page)) {
        this.state.phase = 'waiting-card';
        if (!cardPrompted) {
          cardPrompted = true;
          this.alert('請自行輸入中信卡號前 6 碼並完成驗證；程式不會讀取或儲存卡號');
        }
        await sleep(800);
        continue;
      }

      if (stage === 'sold-out') return { reason: 'sold-out' };

      const selected = await selectKhamOffer(page, config).catch(() => ({ selected: false }));
      if (selected.selected) {
        this.state.phase = 'selecting';
        this.state.ticketStatus = `已選 ${selected.offer.text}`;
        this.log(`已選擇：${selected.offer.text}`);
        if (config.wantVipBenefit && /VIP/i.test(selected.offer.text)) {
          const benefitSelected = await selectKhamVipBenefit(page).catch(() => false);
          this.log(benefitSelected ? '已嘗試加選 VIP 粉絲福利' : '本票種未偵測到可加選的 VIP 粉絲福利');
        }
        if (config.autoAdvance) {
          const advanced = await clickKhamNext(page).catch(() => false);
          this.log(advanced ? '已按一次下一步，請立即確認實名資料與中信付款' : '找不到安全的下一步按鈕，請立即手動接手');
        }
        this.state.phase = 'manual-action';
        await page.screenshot({ path: `${config.artifactsDir}/kham-ticket-selected-${Date.now()}.png`, fullPage: true }).catch(() => {});
        this.alert('已完成票種選擇並停在需要你確認的步驟；請處理實名資料與付款');
        return { reason: 'selected' };
      }

      await sleep(700);
    }

    return { reason: this.stopRequested ? 'stopped' : 'timed-out' };
  }

  async start() {
    if (this.state.running) return;
    this.stopRequested = false;
    this.state.running = true;
    this.state.phase = 'starting';

    try {
      const config = this.getConfig();
      await this.ensureBrowser();
      await this.waitForSaleStart(config);
      if (this.stopRequested) return;

      const primary = await this.runProduct(config.primary, config);
      if (primary.reason === 'sold-out') {
        this.log('2/28 已無可購票券，依設定改嘗試 2/27');
        const fallback = await this.runProduct(config.fallback, config);
        if (fallback.reason !== 'selected') this.alert(`2/27 流程停止：${fallback.reason}，請立即查看寬宏 Chrome`);
      } else if (primary.reason !== 'selected') {
        this.alert(`2/28 流程停止：${primary.reason}，請立即查看寬宏 Chrome`);
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
