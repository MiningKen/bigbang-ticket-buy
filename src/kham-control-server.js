import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

import { attachDashboardShutdown } from './dashboard-lifecycle.js';
import { KhamController } from './kham-controller.js';

const host = '127.0.0.1';
const port = Number.parseInt(process.env.KHAM_CONTROL_PORT || '4174', 10);
const dashboardHeadless = /^(?:1|true|yes)$/i.test(process.env.DASHBOARD_HEADLESS || '');
const root = process.cwd();
const uiRoot = join(root, 'ui');
const controller = new KhamController(root);
let dashboardBrowser = null;
let dashboardPage = null;
let shuttingDown = false;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function serveFile(response, filename) {
  const path = join(uiRoot, filename);
  if (!existsSync(path)) return false;
  const extension = filename.slice(filename.lastIndexOf('.'));
  response.writeHead(200, { 'content-type': contentTypes[extension] || 'application/octet-stream' });
  response.end(readFileSync(path));
  return true;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/api/state') {
      sendJson(response, 200, controller.publicState());
      return;
    }
    if (request.method === 'POST' && request.url === '/api/open-login') {
      sendJson(response, 200, await controller.openLogin());
      return;
    }
    if (request.method === 'POST' && request.url === '/api/start') {
      void controller.start();
      sendJson(response, 202, controller.publicState());
      return;
    }
    if (request.method === 'POST' && request.url === '/api/stop') {
      controller.stop();
      sendJson(response, 200, controller.publicState());
      return;
    }

    const staticFiles = {
      '/': 'kham.html',
      '/kham-app.js': 'kham-app.js',
      '/styles.css': 'styles.css',
    };
    if (request.method === 'GET' && staticFiles[request.url] && serveFile(response, staticFiles[request.url])) return;
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
});

server.on('error', (error) => {
  const message = error.code === 'EADDRINUSE'
    ? `無法啟動：${host}:${port} 已被另一個寬宏控制面板使用。`
    : `寬宏控制面板無法啟動：${error.message}`;
  console.error(message);
  process.exitCode = 1;
});

server.listen(port, host, async () => {
  const url = `http://${host}:${port}`;
  console.log(`寬宏購票控制面板：${url}`);
  try {
    const config = controller.getConfig();
    dashboardBrowser = await chromium.launch({
      executablePath: config.chromePath,
      headless: dashboardHeadless,
      args: ['--window-size=620,820'],
    });
    const context = await dashboardBrowser.newContext({ viewport: { width: 580, height: 740 } });
    dashboardPage = await context.newPage();
    await dashboardPage.goto(url);
    attachDashboardShutdown({ dashboardBrowser, dashboardPage, shutdown });
  } catch (error) {
    console.error(`無法自動開啟控制面板：${error.message}`);
    console.log(`請手動開啟 ${url}`);
  }
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await controller.close();
  await dashboardBrowser?.close().catch(() => {});
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
