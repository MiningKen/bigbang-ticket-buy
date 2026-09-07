import { existsSync, mkdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { chromium } from 'playwright-core';

import { nextPollDelay, readConfig } from './config.js';
import { findSessionByDate, parseDateArgument } from './sessions.js';
import {
  attemptTicketSelection,
  clickTargetSession,
  fetchLiveSessionStatus,
  inspectTargetSession,
  pageNeedsManualAction,
} from './page-actions.js';

if (existsSync('.env')) loadEnvFile('.env');

const mode = process.argv[2] || 'watch';
const dateArgument = parseDateArgument(process.argv.slice(3));
const dateSession = dateArgument ? findSessionByDate(dateArgument) : null;
if (dateArgument && !dateSession) {
  throw new Error(`不支援的場次日期：${dateArgument}。可用日期為 2026-10-09、2026-10-10、2026-10-11。`);
}
const config = readConfig(
  dateSession
    ? {
        ...process.env,
        TARGET_DATE: dateSession.date,
        INTERNAL_SESSION_ID: dateSession.internalSessionId,
      }
    : process.env,
);

function timestamp() {
  return new Date().toLocaleTimeString('zh-TW', { hour12: false });
}

function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

function alertUser(message) {
  process.stdout.write('\u0007\u0007\u0007');
  log(message);
}

async function waitForever() {
  await new Promise(() => {});
}

async function launch() {
  if (!config.chromePath || !existsSync(config.chromePath)) {
    throw new Error('找不到 Chrome 或 Edge，請先安裝其中一個瀏覽器，或設定 CHROME_PATH');
  }
  mkdirSync(config.artifactsDir, { recursive: true });
  return chromium.launchPersistentContext(config.profileDir, {
    executablePath: config.chromePath,
    headless: false,
    viewport: null,
  });
}

async function runLogin() {
  const context = await launch();
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(config.ticketUrl, { waitUntil: 'domcontentloaded' });
  log('請在開啟的 Chrome 完成 Ticket Plus 登入，完成後直接關閉瀏覽器。登入狀態會保存在專用 profile。');
  await context.waitForEvent('close');
}

async function runWatch() {
  const context = await launch();
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(3_000);

  await page.goto(config.ticketUrl, { waitUntil: 'domcontentloaded' });
  log(`開始用輕量狀態 API 監看 ${config.targetDate}；輪詢間隔 ${config.pollMinMs}-${config.pollMaxMs}ms。`);

  for (;;) {
    if (await pageNeedsManualAction(page)) {
      alertUser('偵測到排隊或驗證畫面，請立刻在瀏覽器手動處理。');
      await waitForever();
    }

    const live = await fetchLiveSessionStatus(page, config).catch((error) => {
      log(`狀態 API 讀取失敗：${error.message}`);
      return null;
    });

    if (live && [403, 429].includes(live.httpStatus)) {
      alertUser(`狀態 API 回應 ${live.httpStatus}，已停止以避免繼續觸發限制。`);
      await waitForever();
    }

    let session = await inspectTargetSession(page, config.targetDate);
    if (live?.canBuy && !session.canBuy) {
      log(`API 狀態已變為 ${live.status}，重新載入頁面準備進入購票。`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      session = await inspectTargetSession(page, config.targetDate);
    }

    if (session.canBuy) {
      alertUser(`發現可購票場次：${session.text.replace(/\s+/g, ' ')}`);
      const activityUrl = page.url();
      const clicked = await clickTargetSession(page, config.targetDate);
      if (!clicked) {
        alertUser('找到票券但無法自動點擊，請立即手動點選。');
        await waitForever();
      }

      await page.waitForURL((url) => url.href !== activityUrl, { timeout: 10_000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(750);
      const result = await attemptTicketSelection(page, config);
      await page.screenshot({
        path: `${config.artifactsDir}/ticket-found-${Date.now()}.png`,
        fullPage: true,
      }).catch(() => {});

      if (result.reason === 'challenge') {
        alertUser('已進入購票流程並遇到驗證／排隊，請手動接手。');
      } else if (result.reason === 'no-price-preference') {
        alertUser('已進入購票流程；未設定票價偏好，請手動選票。');
      } else if (result.reason === 'preferred-price-unavailable') {
        alertUser('已進入購票流程，但偏好票價目前不可選，請手動接手。');
      } else if (result.reason === 'advanced') {
        alertUser(`已選擇 ${result.selectedPrice} 元並送出下一步；請檢查座位、實名資料與付款。`);
      } else if (result.reason === 'advanced-non-adjacent') {
        alertUser(`連號配位未成功，已接受不連位重試並進入下一步；請檢查座位、實名資料與付款。`);
      } else if (result.reason === 'non-adjacent-fallback-failed') {
        alertUser('連號與不連號配位都未成功，請立即手動檢查其他票區。');
      } else if (result.reason === 'advance-failed') {
        alertUser('自動送出未成功；已依你的連號策略停止，請立即手動檢查。');
      } else {
        alertUser(`已選擇 ${result.selectedPrice} 元；請確認畫面並繼續。`);
      }
      await waitForever();
    } else {
      const pageStatus = session.found ? session.text.replace(/\s+/g, ' ') : '頁面中找不到目標場次';
      const apiStatus = live ? `${live.status || 'unknown'} @ ${live.updatedAt || 'unknown'}` : 'unavailable';
      log(`尚無票；API=${apiStatus}；頁面=${pageStatus}`);
    }

    const delay = nextPollDelay(config);
    await page.waitForTimeout(delay);
  }
}

try {
  if (mode === 'login') await runLogin();
  else if (mode === 'watch') await runWatch();
  else throw new Error(`Unknown mode: ${mode}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
