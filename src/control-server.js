import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

import { TicketController } from './controller.js';

const host = '127.0.0.1';
const port = Number.parseInt(process.env.CONTROL_PORT || '4173', 10);
const dashboardHeadless = /^(?:1|true|yes)$/i.test(process.env.DASHBOARD_HEADLESS || '');
const root = process.cwd();
const uiRoot = join(root, 'ui');
const controller = new TicketController(root);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error('Request too large');
  }
  return JSON.parse(body || '{}');
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
    if (request.method === 'POST' && request.url === '/api/config') {
      sendJson(response, 200, controller.savePreferences(await readJson(request)));
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
      '/': 'index.html',
      '/app.js': 'app.js',
      '/styles.css': 'styles.css',
    };
    if (request.method === 'GET' && staticFiles[request.url] && serveFile(response, staticFiles[request.url])) {
      return;
    }
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
});

server.listen(port, host, async () => {
  const url = `http://${host}:${port}`;
  console.log(`Ticket Plus 控制面板：${url}`);
  try {
    const config = controller.getConfig();
    const dashboardBrowser = await chromium.launch({
      executablePath: config.chromePath,
      headless: dashboardHeadless,
      args: ['--window-size=620,820'],
    });
    const context = await dashboardBrowser.newContext({ viewport: { width: 580, height: 740 } });
    const page = await context.newPage();
    await page.goto(url);
    dashboardBrowser.on('disconnected', () => shutdown());
  } catch (error) {
    console.error(`無法自動開啟控制面板：${error.message}`);
    console.log(`請手動開啟 ${url}`);
  }
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await controller.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
