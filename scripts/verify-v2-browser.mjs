import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
});

function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let target = resolve(ROOT, `.${pathname}`);
      if (target !== ROOT && !target.startsWith(`${ROOT}${sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
      const body = await readFile(target);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME_TYPES[extname(target)] || 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

async function waitForGeneration(page) {
  await page.waitForFunction(() => !document.getElementById('generate-button').disabled);
}

const server = await startStaticServer();
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          globalThis.__v2ClipboardCalls = (globalThis.__v2ClipboardCalls || 0) + 1;
          globalThis.__v2ClipboardLength = value.length;
        },
      },
    });
    globalThis.__v2ClipboardCalls = 0;
  });
  const page = await context.newPage();
  await page.route('**/assets/v2/password-worker.v2.js', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body: source.replace("'use strict';", "'use strict';\nDate.now = () => 1000;"),
      contentType: 'text/javascript; charset=utf-8',
    });
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/index-2.0.html#password`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.passwordGeneratorReady === 'true');

  assert.equal(await page.locator('.mode-link').count(), 9);
  assert.equal(await page.locator('#history-toggle').isChecked(), false);
  assert.equal(await page.evaluate(() => globalThis.__v2ClipboardCalls), 0);

  const modes = ['password', 'passphrase', 'pin', 'mnemonic', 'token', 'apiSecret', 'hex', 'randomBytes', 'uuid'];
  for (const mode of modes) {
    await page.locator(`.mode-link[data-mode="${mode}"]`).click();
    await page.getByRole('button', { name: '生成' }).click();
    await waitForGeneration(page);
    assert.equal(await page.locator('#result-container article').count(), 1, `${mode} result`);
    assert.equal(await page.locator('#result-container .metric').count(), 4, `${mode} metrics`);
    assert.equal(await page.locator('#result-container .secret-value').getAttribute('data-secret-state'), 'masked');
    assert.match(await page.locator('#result-container .secret-value').textContent(), /^•+$/);
  }
  assert.equal(await page.evaluate(() => globalThis.__v2ClipboardCalls), 0);

  await page.locator('.mode-link[data-mode="password"]').click();
  await page.locator('input[name="quantity"]').fill('2');
  await page.getByRole('button', { name: '生成' }).click();
  await waitForGeneration(page);
  const batchIds = await page.locator('#result-container article').evaluateAll((cards) => (
    cards.map((card) => card.dataset.resultId)
  ));
  assert.equal(batchIds.length, 2);
  assert.equal(new Set(batchIds).size, 2);
  await page.locator('#result-container article').first().getByRole('button', { name: '显示明文' }).click();
  assert.equal(await page.locator('.secret-value[data-secret-state="revealed"]').count(), 1);
  await page.locator('#result-container article').first().getByRole('button', { name: '隐藏明文' }).click();

  await page.locator('.mode-link[data-mode="mnemonic"]').click();
  await page.locator('select[name="language"]').selectOption('japanese');
  await page.waitForFunction(() => globalThis.PasswordGeneratorV2.bip39
    .getBip39WordlistStatus('japanese').state === 'ready');
  await waitForGeneration(page);
  await page.getByRole('button', { name: '生成' }).click();
  await waitForGeneration(page);
  assert.equal(await page.locator('#result-container article').count(), 1);
  assert.match(await page.locator('#resource-strip').textContent(), /BIP39 日本語 · ready/);

  await page.locator('.mode-link[data-mode="randomBytes"]').click();
  await page.locator('input[name="byteLength"]').fill('1048576');
  await page.getByRole('button', { name: '生成' }).click();
  await waitForGeneration(page);
  await page.getByRole('button', { name: '显示明文' }).click();
  assert.equal(
    await page.locator('#result-container .secret-value').textContent(),
    '明文过长，未渲染到 DOM。请显式复制或下载。',
  );
  assert.equal(await page.getByRole('button', { name: '下载原始字节' }).count(), 1);
  await page.getByRole('button', { name: '隐藏明文' }).click();

  await page.getByRole('button', { name: '显示明文' }).click();
  assert.equal(await page.locator('#result-container .secret-value').getAttribute('data-secret-state'), 'revealed');
  await page.getByRole('button', { name: '隐藏明文' }).click();
  assert.match(await page.locator('#result-container .secret-value').textContent(), /^•+$/);

  await page.getByRole('button', { name: '复制当前结果' }).click();
  assert.equal(await page.evaluate(() => globalThis.__v2ClipboardCalls), 1);
  assert.ok(await page.evaluate(() => globalThis.__v2ClipboardLength > 0));

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = () => { throw new Error('forced copy failure'); };
  });
  await page.getByRole('button', { name: '复制当前结果' }).click();
  assert.equal(await page.locator('textarea[aria-hidden="true"]').count(), 0);
  assert.match(await page.locator('#toast').textContent(), /复制失败/);

  await page.locator('.mode-link[data-mode="uuid"]').click();
  await page.locator('#history-toggle').check();
  await page.getByRole('button', { name: '生成' }).click();
  await waitForGeneration(page);
  await page.getByRole('button', { name: '生成' }).click();
  await waitForGeneration(page);
  assert.equal(await page.locator('#history-container article').count(), 2);
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), []);
  await page.locator('#history-toggle').uncheck();
  assert.equal(await page.locator('#history-container article').count(), 0);

  const analyticsIsolation = await page.evaluate(() => {
    const frame = document.querySelector('iframe[title="匿名页面访问统计"]');
    return {
      sandbox: frame?.getAttribute('sandbox'),
      referrerPolicy: frame?.referrerPolicy,
      parentReadable: Boolean(frame?.contentDocument),
      parentGoogleScripts: [...document.scripts].filter((script) => /google|gtag/i.test(script.src)).length,
    };
  });
  assert.deepEqual(analyticsIsolation, {
    sandbox: 'allow-scripts',
    referrerPolicy: 'no-referrer',
    parentReadable: false,
    parentGoogleScripts: 0,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(pageErrors, []);

  const noCryptoContext = await browser.newContext();
  await noCryptoContext.addInitScript(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  });
  const noCryptoPage = await noCryptoContext.newPage();
  await noCryptoPage.goto(`${baseUrl}/index-2.0.html`, { waitUntil: 'domcontentloaded' });
  await noCryptoPage.waitForFunction(() => document.documentElement.dataset.passwordGeneratorReady === 'true');
  assert.equal(await noCryptoPage.locator('#generate-button').isDisabled(), true);
  assert.match(await noCryptoPage.locator('#resource-strip').textContent(), /Web Crypto 不可用/);
  await noCryptoContext.close();

  const recoveryContext = await browser.newContext();
  const recoveryPage = await recoveryContext.newPage();
  let blockPinRisk = true;
  let blockPassphrase = true;
  let blockAnalyzer = true;
  await recoveryPage.route('**/assets/v2/pin-risk.v2.js', (route) => (
    blockPinRisk ? route.abort() : route.continue()
  ));
  await recoveryPage.route('**/assets/js/embedded-word-packs.js', (route) => (
    blockPassphrase ? route.abort() : route.continue()
  ));
  await recoveryPage.route('**/assets/v2/zxcvbn-analyzer.v2.min.js', (route) => (
    blockAnalyzer ? route.abort() : route.continue()
  ));
  await recoveryPage.goto(`${baseUrl}/index-2.0.html`, { waitUntil: 'domcontentloaded' });
  await recoveryPage.waitForFunction(() => document.documentElement.dataset.passwordGeneratorReady === 'true');
  await recoveryPage.waitForFunction(() => [...document.querySelectorAll('.resource-item')].filter((item) => (
    ['error', 'degraded'].includes(item.dataset.state)
  )).length >= 3);
  blockPinRisk = false;
  blockPassphrase = false;
  blockAnalyzer = false;
  for (const label of ['PIN 风险库', 'Passphrase 词包', '模式分析']) {
    const item = recoveryPage.locator('.resource-item').filter({ hasText: label });
    await item.getByRole('button', { name: '重试' }).click();
    await recoveryPage.waitForFunction((resourceLabel) => (
      [...document.querySelectorAll('.resource-item')].some((node) => (
        node.textContent.includes(resourceLabel) && node.dataset.state === 'ready'
      ))
    ), label);
  }
  assert.match(await recoveryPage.locator('#resource-strip').textContent(), /PIN 风险库 · ready/);
  assert.match(await recoveryPage.locator('#resource-strip').textContent(), /Passphrase 词包 · ready/);
  assert.match(await recoveryPage.locator('#resource-strip').textContent(), /模式分析 · ready/);
  await recoveryContext.close();

  const missingRuntimeContext = await browser.newContext();
  const missingRuntimePage = await missingRuntimeContext.newPage();
  await missingRuntimePage.route('**/assets/v2/runtime.v2.min.js', (route) => route.abort());
  await missingRuntimePage.goto(`${baseUrl}/index-2.0.html`, { waitUntil: 'domcontentloaded' });
  await missingRuntimePage.waitForFunction(() => document.documentElement.dataset.passwordGeneratorError === 'true');
  assert.equal(await missingRuntimePage.locator('#generate-button').isDisabled(), true);
  assert.match(await missingRuntimePage.locator('#resource-strip').textContent(), /核心运行时加载失败/);
  assert.equal(await missingRuntimePage.getByRole('button', { name: '重新加载页面' }).count(), 1);
  await missingRuntimeContext.close();
  await context.close();

  console.log('V2 browser verification passed: 9 modes, privacy controls, GA sandbox, responsive layout, Web Crypto fail-closed.');
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}
