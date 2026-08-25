import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(ROOT, 'assets/v2.01/manifest.json'), 'utf8'));
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
});

function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let target = resolve(ROOT, `.${pathname}`);
      if (target !== ROOT && !target.startsWith(`${ROOT}${sep}`)) { response.writeHead(403).end('Forbidden'); return; }
      if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
      const body = await readFile(target);
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': MIME_TYPES[extname(target)] || 'application/octet-stream' });
      response.end(body);
    } catch { response.writeHead(404).end('Not found'); }
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer(server)));
}

async function waitReady(page) {
  await page.waitForFunction(() => document.documentElement.dataset.passwordGeneratorReady === 'true');
  await page.waitForFunction(() => !document.getElementById('generate-button').disabled);
}

async function clickGenerate(page) {
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('generate-button').textContent.includes('生成中'));
}

const server = await startStaticServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

try {
  const gaRequests = [];
  const googleRequestUrls = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.on('request', (request) => { if (/google/iu.test(request.url())) googleRequestUrls.push(request.url()); });
  await context.addInitScript(() => {
    globalThis.__v201Clipboard = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { globalThis.__v201Clipboard.push(value); } } });
    globalThis.confirm = () => true;
  });
  await context.route('https://www.googletagmanager.com/gtag/js**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: `(function wait(){var rows=globalThis.dataLayer||[];var row=rows.find(function(item){return item&&item[0]==='config';});if(!row){setTimeout(wait,5);return;}var config=row[2]||{};var query=new URLSearchParams({dl:config.page_location||'',dp:config.page_path||'',dt:config.page_title||'',dr:config.page_referrer||'',cid:'cookieless-test'});fetch('https://www.google-analytics.com/g/collect?'+query.toString(),{method:'POST',body:'en=page_view'});})();`,
  }));
  await context.route('**/g/collect**', async (route) => {
    const request = route.request();
    gaRequests.push({ url: request.url(), body: request.postData() || '', headers: await request.allHeaders() });
    await route.fulfill({ status: 204, body: '' });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/v2.01.html#password`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  assert.equal(await page.locator('.mode-link').count(), 9);
  assert.equal(await page.locator('#history-toggle').isChecked(), false);
  assert.equal(await page.evaluate(() => globalThis.__v201Clipboard.length), 0);
  assert.equal(await page.locator('iframe[title="隔离页面访问统计"]').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('iframe[title="隔离页面访问统计"]')?.contentDocument)), false);
  assert.equal(await page.evaluate(() => [...document.scripts].some((script) => /google|gtag/iu.test(script.src))), false);

  const modeLabels = new Map([
    ['password', ['密码', 'Password', '密码策略配置', '密码生成结果']],
    ['passphrase', ['口令', 'Passphrase', '口令策略配置', '口令生成结果']],
    ['pin', ['PIN 码', 'PIN', 'PIN 码策略配置', 'PIN 码生成结果']],
    ['mnemonic', ['助记词', 'Mnemonic', '助记词策略配置', '助记词生成结果']],
    ['token', ['令牌', 'Token', '令牌策略配置', '令牌生成结果']],
    ['apiSecret', ['API 密钥', 'API Secret', 'API 密钥策略配置', 'API 密钥生成结果']],
    ['hex', ['十六进制', 'Hex', '十六进制策略配置', '十六进制生成结果']],
    ['randomBytes', ['随机字节', 'Random Bytes', '随机字节策略配置', '随机字节生成结果']],
    ['uuid', ['UUID 标识符', 'UUID', 'UUID 标识符策略配置', 'UUID 标识符生成结果']],
  ]);
  assert.equal(await page.locator('#mode-panel-title').textContent(), '1、选择生成类型');
  for (const [mode, [zh, en, configTitle, resultTitle]] of modeLabels) {
    const modeButton = page.locator(`.mode-link[data-mode="${mode}"]`);
    assert.equal(await modeButton.locator('.mode-label-zh').textContent(), zh);
    assert.equal(await modeButton.locator('.mode-label-en').textContent(), en);
    await modeButton.click();
    if (mode === 'mnemonic') await page.locator('input[name="mnemonicAck"]').check();
    await waitReady(page);
    await clickGenerate(page);
    assert.equal(await page.locator('#result-container article').count(), 1, `${mode} result`);
    assert.equal(await page.locator('#config-title').textContent(), configTitle);
    assert.equal(await page.locator('#result-title').textContent(), resultTitle);
    assert.equal(await page.locator('#result-container .result-type').textContent(), zh);
    assert.doesNotMatch(await page.locator('#result-container .secret-value').textContent(), /^•+$/u);
    assert.match(await page.locator('#result-container').textContent(), /精确生成器指标/u);
  }
  assert.equal(await page.evaluate(() => globalThis.__v201Clipboard.length), 0, '生成不得自动复制');

  await page.locator('.mode-link[data-mode="password"]').click();
  await clickGenerate(page);
  const resultCard = page.locator('#result-container .result-card').first();
  const toggleButton = resultCard.locator('[data-secret-toggle]');
  await toggleButton.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const beforeToggle = await resultCard.boundingBox();
  const beforePageScroll = await page.evaluate(() => scrollY);
  const beforeScrollTop = await page.locator('#result-container').evaluate((node) => node.scrollTop);
  await toggleButton.click();
  const afterHide = await resultCard.boundingBox();
  assert.deepEqual(afterHide, beforeToggle, '隐藏内容不得改变结果卡几何位置');
  assert.equal(await page.evaluate(() => scrollY), beforePageScroll, '隐藏内容不得晃动页面滚动位置');
  assert.equal(await page.locator('#result-container').evaluate((node) => node.scrollTop), beforeScrollTop);
  assert.equal(await resultCard.locator('.secret-value').getAttribute('data-secret-state'), 'masked');
  assert.match(await resultCard.locator('.secret-value').evaluate((node) => getComputedStyle(node, '::before').content), /•+/u);
  assert.equal(await toggleButton.evaluate((node) => document.activeElement === node), true, '切换后保持键盘焦点');
  assert.equal(await resultCard.evaluate((node) => getComputedStyle(node).animationName), 'none');
  await toggleButton.click();
  assert.deepEqual(await resultCard.boundingBox(), beforeToggle, '显示内容不得改变结果卡几何位置');
  assert.equal(await page.evaluate(() => scrollY), beforePageScroll, '显示内容不得晃动页面滚动位置');
  assert.equal(await resultCard.locator('.secret-value').getAttribute('data-secret-state'), 'revealed');

  await page.locator('.mode-link[data-mode="uuid"]').click();
  await clickGenerate(page);
  assert.match(await page.locator('#result-container').textContent(), /这是标识符，不是秘密/u);
  assert.doesNotMatch(await page.locator('#result-container').textContent(), /攻击场景估算|强度等级|快速离线/u);

  await page.locator('.mode-link[data-mode="mnemonic"]').click();
  assert.equal(await page.locator('input[name="mnemonicAck"]').isChecked(), false, 'BIP39 acknowledgement must not persist');
  await page.locator('input[name="mnemonicAck"]').check();
  await page.locator('select[name="language"]').selectOption('japanese');
  await page.locator('select[name="language"]').selectOption('english');
  await page.waitForFunction(() => document.querySelector('.resource-item')?.ownerDocument.body.textContent.includes('BIP39 英语 · 已就绪'));
  await clickGenerate(page);
  assert.match(await page.locator('#result-container').textContent(), /校验和有效/u);
  assert.doesNotMatch(await page.locator('#result-container').textContent(), /攻击场景估算|快速离线/u);

  await page.locator('.mode-link[data-mode="pin"]').click();
  await page.locator('select[name="length"]').selectOption('4');
  await page.locator('input[name="quantity"]').fill('100');
  await clickGenerate(page);
  assert.equal(await page.locator('#result-container article').count(), 100);
  await page.getByRole('button', { name: '复制全部' }).click();
  const pinBatch = await page.evaluate(() => globalThis.__v201Clipboard.at(-1).split('\n'));
  assert.equal(pinBatch.length, 100);
  assert.equal(new Set(pinBatch).size, 100, 'PIN batch must be unique');

  await page.locator('.mode-link[data-mode="password"]').click();
  await page.locator('input[name="length"]').fill('4096');
  await page.locator('input[name="quantity"]').fill('100');
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await page.locator('.mode-link[data-mode="uuid"]').click();
  await page.waitForFunction(() => document.getElementById('config-title').textContent === 'UUID 标识符策略配置');
  assert.equal(await page.locator('#result-container article').count(), 0, 'stale Password batch must not commit');
  await waitReady(page);
  await clickGenerate(page);
  assert.match(await page.locator('#result-container').textContent(), /这是标识符，不是秘密/u);

  const sentinel = 'V2_SECRET_SENTINEL_9f8a7c6b5d4e';
  await page.locator('.mode-link[data-mode="token"]').click();
  await page.locator('#history-toggle').check();
  await page.locator('input[name="prefix"]').fill(`${sentinel}_`);
  await clickGenerate(page);
  await page.locator('input[name="prefix"]').fill('');
  assert.match(await page.locator('#result-container .secret-value').textContent(), new RegExp(sentinel), '当前结果默认显示明文');
  assert.equal(await page.locator('.history-row').count(), 1);
  const historyPreview = page.locator('.history-preview').first();
  assert.equal(await historyPreview.evaluate((node) => getComputedStyle(node).whiteSpace), 'nowrap');
  await historyPreview.hover();
  assert.match(await page.locator('.history-tooltip').textContent(), new RegExp(sentinel));
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => !document.querySelector('.history-tooltip'));
  await historyPreview.click();
  assert.match(await page.evaluate(() => globalThis.__v201Clipboard.at(-1)), new RegExp(sentinel));
  await page.locator('#copy-share').click();
  const shareText = await page.evaluate(() => globalThis.__v201Clipboard.at(-1));
  assert.match(shareText, /V2\.0\.1/u);
  assert.match(shareText, /https:\/\/betaer\.github\.io\/password-generator\/v2\.01\.html/u);
  assert.equal(shareText.includes(sentinel), false, '网站分享文案不得包含生成结果');
  assert.equal(await page.locator('.site-floating-star-badge').textContent(), '999+');
  await page.waitForTimeout(1000);
  assert.ok(gaRequests.length >= 1, `GA collect request must be observed; Google requests: ${googleRequestUrls.join(', ')}`);
  for (const request of gaRequests) {
    const combined = `${request.url}\n${request.body}\n${JSON.stringify(request.headers)}`;
    assert.equal(combined.includes(sentinel), false);
    assert.equal(request.headers.cookie, undefined);
    const url = new URL(request.url);
    assert.equal(url.searchParams.get('dl'), 'https://betaer.github.io/password-generator/v2.01.html');
    assert.equal(url.searchParams.get('dr'), '');
    assert.equal(url.searchParams.get('dp'), '/password-generator/v2.01.html');
  }
  await page.locator('.history-row').first().getByRole('button', { name: '删除' }).click();
  assert.equal(await page.locator('.history-row').count(), 0, '生成记录支持逐条删除');

  await page.locator('.mode-link[data-mode="randomBytes"]').click();
  await page.locator('input[name="byteLength"]').fill('1048576');
  await page.locator('input[name="quantity"]').fill('2');
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('64 KiB'));
  assert.match(await page.locator('#toast').textContent(), /64 KiB.*quantity.*1/u);
  await page.locator('input[name="quantity"]').fill('1');
  await clickGenerate(page);
  assert.match(await page.locator('#result-container').textContent(), /2\^8,388,608/u);
  const randomBytesToggle = page.locator('#result-container [data-secret-toggle]');
  await randomBytesToggle.click();
  assert.equal(await randomBytesToggle.textContent(), '显示内容');
  await randomBytesToggle.click();
  assert.equal(await randomBytesToggle.textContent(), '隐藏内容');
  assert.ok((await page.locator('#result-container .secret-value').textContent()).length < 200);
  assert.ok((await page.locator('#result-container').textContent()).length < 20_000);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = () => { throw new Error('forced copy failure'); };
  });
  await page.getByRole('button', { name: '复制当前结果' }).click();
  assert.equal(await page.locator('[data-v201-clipboard-fallback]').count(), 0);
  assert.match(await page.locator('#toast').textContent(), /forced copy failure|复制/u);

  await page.locator('.mode-link[data-mode="uuid"]').click();
  await page.locator('select[name="version"]').selectOption('7');
  await page.getByRole('button', { name: '恢复默认' }).click();
  await page.waitForFunction(() => document.querySelector('select[name="version"]')?.value === '4');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  assert.equal(await page.locator('select[name="version"]').inputValue(), '4');

  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal overflow at ${viewport.width}`);
  }
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => !document.getElementById('back-to-top').hidden);
  await page.locator('#back-to-top').click();
  assert.equal(await page.evaluate(() => scrollY), 0, '回到顶部使用即时滚动');
  assert.deepEqual(pageErrors, []);
  await context.close();

  const noCryptoContext = await browser.newContext();
  await noCryptoContext.addInitScript(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} }); });
  const noCryptoPage = await noCryptoContext.newPage();
  await noCryptoPage.goto(`${baseUrl}/v2.01.html`, { waitUntil: 'domcontentloaded' });
  await noCryptoPage.waitForFunction(() => document.documentElement.dataset.passwordGeneratorReady === 'true');
  assert.equal(await noCryptoPage.locator('#generate-button').isDisabled(), true);
  assert.match(await noCryptoPage.locator('#crypto-status-chip').textContent(), /已停止/u);
  await noCryptoContext.close();

  process.stdout.write('V2.0.1 browser verification passed: nine profiles, cancellation, unique PIN batch, budgets, DOM/clipboard privacy, GA network isolation, responsive layouts.\n');
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
