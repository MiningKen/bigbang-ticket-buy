import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { chromium } from 'playwright-core';

import { pageForExistingContext } from './browser-session.js';
import { nextPollDelay, readConfig } from './config.js';
import {
  attemptTicketSelection,
  clickTargetSession,
  detectLoginStatus,
  fetchLiveSessionStatus,
  inspectTargetSession,
  pageNeedsManualAction,
} from './page-actions.js';
import { inferPollMode, preferencesToEnv, validatePreferences } from './preferences.js';
import { updateEnvValues } from './sessions.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class TicketController {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
    this.envPath = `${cwd}/.env`;
    this.context = null;
    this.page = null;
    this.stopRequested = false;
    this.state = {
      running: false,
      browserOpen: false,
      loginStatus: 'unknown',
      ticketStatus: 'unknown',
      ticketUpdatedAt: null,
      phase: 'idle',
      message: '尚未啟動',
      logs: [],
      alertId: 0,
      alertMessage: null,
    };
  }

  getConfig() {
    const fileEnv = existsSync(this.envPath) ? parseEnv(readFileSync(this.envPath, 'utf8')) : {};
    return readConfig({ ...process.env, ...fileEnv }, this.cwd);
  }

  publicState() {
    const config = this.getConfig();
    return {
      ...this.state,
      config: {
        targetDate: config.targetDate,
        ticketCount: config.ticketCount,
        preferredPrices: config.preferredPrices.join(','),
        seatingMode: config.seatingMode,
        autoAdvance: config.autoAdvance && config.acceptTerms,
        pollMode: inferPollMode(config.pollMinMs, config.pollMaxMs),
      },
    };
  }

  log(message) {
    const entry = {
      at: new Date().toISOString(),
      message,
    };
    this.state.logs = [entry, ...this.state.logs].slice(0, 30);
    this.state.message = message;
    console.log(`[${new Date().toLocaleTimeString('zh-TW', { hour12: false })}] ${message}`);
  }

  alert(message) {
    process.stdout.write('\u0007\u0007\u0007');
    this.state.alertId += 1;
    this.state.alertMessage = message;
    this.log(message);
  }

  savePreferences(input) {
    if (this.state.running) throw new Error('請先停止監看再修改設定');
    const preferences = validatePreferences(input);
    const contents = existsSync(this.envPath) ? readFileSync(this.envPath, 'utf8') : '';
    writeFileSync(this.envPath, updateEnvValues(contents, preferencesToEnv(preferences)));
    this.log('設定已儲存');
    return this.publicState();
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
        await this.page.goto(config.ticketUrl, { waitUntil: 'domcontentloaded' });
        this.state.browserOpen = true;
        await this.refreshLoginStatus();
        this.log('已重新使用既有的 Ticket Plus Chrome 分頁');
        return this.page;
      } catch (error) {
        if (!/Target page, context or browser has been closed/i.test(error.message)) throw error;
        this.context = null;
        this.page = null;
        this.state.browserOpen = false;
      }
    }

    this.log('正在開啟 Ticket Plus Chrome…');
    try {
      this.context = await chromium.launchPersistentContext(config.profileDir, {
        executablePath: config.chromePath,
        headless: false,
        viewport: null,
      });
    } catch (error) {
      if (/Target page, context or browser has been closed/i.test(error.message)) {
        throw new Error('Ticket Plus Chrome 已在執行，但連線已遺失。請關閉那個專用 Chrome 視窗後，再按一次「開啟登入頁」。');
      }
      throw error;
    }

    this.page = await pageForExistingContext(this.context, this.page);
    this.configurePage(this.page);
    this.context.on('close', () => {
      this.context = null;
      this.page = null;
      this.state.browserOpen = false;
      this.state.loginStatus = 'unknown';
      this.stop();
    });

    await this.page.goto(config.ticketUrl, { waitUntil: 'domcontentloaded' });
    this.state.browserOpen = true;
    await this.refreshLoginStatus();
    this.log('Ticket Plus Chrome 已開啟');
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
        this.log('Ticket Plus 分頁已關閉，監看已停止');
      }
    });
  }

  async refreshLoginStatus() {
    if (!this.page || this.page.isClosed()) {
      this.state.loginStatus = 'unknown';
      return this.state.loginStatus;
    }
    this.state.loginStatus = await detectLoginStatus(this.page);
    return this.state.loginStatus;
  }

  async openLogin() {
    const page = await this.ensureBrowser();
    await page.bringToFront();
    await this.refreshLoginStatus();
    return this.publicState();
  }

  stop() {
    this.stopRequested = true;
    if (this.state.running) this.log('正在停止監看…');
  }

  async start() {
    if (this.state.running) return;
    this.stopRequested = false;
    this.state.running = true;
    this.state.phase = 'starting';

    try {
      const page = await this.ensureBrowser();
      const config = this.getConfig();
      this.log(`開始監看 ${config.targetDate}，${config.ticketCount} 張，策略 ${config.seatingMode}`);

      while (!this.stopRequested) {
        await this.refreshLoginStatus();
        if (this.state.loginStatus !== 'logged-in') {
          this.state.phase = 'waiting-login';
          this.log('尚未偵測到登入，請在 Ticket Plus Chrome 完成登入');
          await sleep(3_000);
          continue;
        }

        if (await pageNeedsManualAction(page)) {
          this.state.phase = 'manual-action';
          this.alert('偵測到排隊或驗證畫面，請在 Ticket Plus Chrome 手動處理');
          await sleep(2_000);
          continue;
        }

        this.state.phase = 'watching';
        const live = await fetchLiveSessionStatus(page, config);
        this.state.ticketStatus = live.status || 'unknown';
        this.state.ticketUpdatedAt = live.updatedAt;

        if ([403, 429].includes(live.httpStatus)) {
          this.state.phase = 'blocked';
          this.alert(`狀態 API 回應 ${live.httpStatus}，已停止以避免觸發更多限制`);
          break;
        }

        let session = await inspectTargetSession(page, config.targetDate);
        if (live.canBuy && !session.canBuy) {
          this.log(`票況變為 ${live.status}，重新載入購票頁`);
          await page.reload({ waitUntil: 'domcontentloaded' });
          session = await inspectTargetSession(page, config.targetDate);
        }

        if (session.canBuy) {
          this.state.phase = 'buying';
          this.alert('發現票券，正在進入購票流程');
          const activityUrl = page.url();
          if (!(await clickTargetSession(page, config.targetDate))) {
            this.state.phase = 'manual-action';
            this.alert('無法自動點擊購買，請立即手動接手');
            break;
          }

          await page.bringToFront();
          await page.waitForURL((url) => url.href !== activityUrl, { timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(750);
          const result = await attemptTicketSelection(page, config);
          await page
            .screenshot({
              path: `${config.artifactsDir}/ticket-found-${Date.now()}.png`,
              fullPage: true,
            })
            .catch(() => {});
          this.state.phase = 'manual-action';
          this.alert(this.describeSelectionResult(result));
          break;
        }

        this.log(`目前票況：${live.status || 'unknown'}`);
        await sleep(nextPollDelay(config));
      }
    } catch (error) {
      this.state.phase = 'error';
      this.log(`錯誤：${error.message}`);
    } finally {
      this.state.running = false;
      if (this.stopRequested) {
        this.state.phase = 'idle';
        this.log('監看已停止');
      }
    }
  }

  describeSelectionResult(result) {
    const messages = {
      challenge: '已進入購票流程，請手動處理驗證或排隊',
      'no-price-preference': '已進入購票流程，請手動選擇票價',
      'preferred-price-unavailable': '偏好票價目前不可選，請立即手動接手',
      advanced: `已選擇 ${result.selectedPrice} 元並進入下一步，請檢查實名資料與付款`,
      'advanced-non-adjacent': '連號失敗，已改用不連號並進入下一步，請檢查座位與付款',
      'non-adjacent-fallback-failed': '連號與不連號都未成功，請立即手動選擇其他票區',
      'advance-failed': '自動進入下一步未成功，請立即手動接手',
      'selected-awaiting-review': `已選擇 ${result.selectedPrice} 元，等待你確認`,
    };
    return messages[result.reason] || `購票流程狀態：${result.reason}`;
  }

  async close() {
    this.stop();
    if (this.context) await this.context.close().catch(() => {});
  }
}
