import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(ROOT, 'assets/v2.1/manifest.json'), 'utf8'));
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
    globalThis.__v21Clipboard = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { globalThis.__v21Clipboard.push(value); } } });
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
  await page.goto(`${baseUrl}/index-2.1.html#password`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.resource-item')]
    .some((item) => item.textContent.includes('BIP39 英语 · 已就绪')));
  assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://betaer.github.io/password-generator/index-2.1.html');
  assert.equal(await page.locator('link[hreflang="en"]').count(), 0, '没有独立英文页面时不得声明英文 hreflang');
  const publishedStructuredData = JSON.parse(await page.locator('#v21-structured-data').textContent());
  const publishedApplication = publishedStructuredData['@graph'].find((entry) => entry['@type'] === 'SoftwareApplication');
  assert.equal(publishedApplication.inLanguage, 'zh-CN');
  assert.equal(publishedApplication.image, 'https://betaer.github.io/password-generator/assets/social-preview-v2.1.png');
  assert.equal(publishedApplication.screenshot, undefined);
  assert.equal(await page.locator('.mode-link').count(), 9);
  assert.equal(await page.locator('#history-toggle').isChecked(), false);
  assert.equal(await page.locator('#history-panel').getAttribute('open'), null, '生成记录默认折叠');
  assert.equal(await page.locator('.result-scroll').evaluate((node) => node.contains(document.getElementById('history-panel'))), true);
  assert.equal(await page.locator('.history-top-actions').isVisible(), true, '记录开关位于折叠导航顶层');
  await page.locator('#history-toggle').check();
  assert.equal(await page.locator('#history-panel').getAttribute('open'), null, '顶层记录开关不得连带展开详情');
  await page.locator('#history-toggle').uncheck();
  assert.equal(await page.evaluate(() => globalThis.__v21Clipboard.length), 0);
  assert.equal(await page.locator('iframe[title="隔离页面访问统计"]').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('iframe[title="隔离页面访问统计"]')?.contentDocument)), false);
  assert.equal(await page.evaluate(() => [...document.scripts].some((script) => /google|gtag/iu.test(script.src))), false);

  assert.equal(await page.locator('.preset-slider-range').count(), 3);
  assert.equal(await page.locator('[data-preset-slider="complexity"] .preset-slider-range').getAttribute('max'), '7');
  assert.equal(await page.locator('[data-preset-slider="length"] .preset-slider-range').getAttribute('max'), '11');
  assert.equal(await page.locator('[data-preset-slider="quantity"] .preset-slider-range').getAttribute('max'), '7');
  assert.equal(await page.locator('[data-complexity-level]').count(), 8);
  assert.equal(await page.locator('[data-preset-custom="complexity"]').count(), 0);
  assert.equal(await page.locator('[data-complexity-level="L8"]').getAttribute('aria-pressed'), 'true');
  await page.locator('input[name="symbolPool"]').fill('');
  await page.locator('[data-complexity-level="L1"]').click();
  assert.equal(await page.locator('input[name="length"]').inputValue(), '4');
  assert.equal(await page.locator('input[name="digits"]').isChecked(), true);
  assert.equal(await page.locator('input[name="lowercase"]').isChecked(), false);
  assert.notEqual(await page.locator('input[name="symbolPool"]').inputValue(), '');
  await clickGenerate(page);
  assert.equal(await page.locator('#result-container article').count(), 1, '空符号池后 L1 仍可生成');
  await page.locator('input[name="symbolPool"]').fill('');
  await page.locator('[data-complexity-level="L8"]').click();
  assert.equal(await page.locator('input[name="length"]').inputValue(), '20');
  for (const name of ['lowercase', 'uppercaseLetters', 'digits', 'symbols']) {
    assert.equal(await page.locator(`input[name="${name}"]`).isChecked(), true);
  }
  assert.notEqual(await page.locator('input[name="symbolPool"]').inputValue(), '');
  await clickGenerate(page);
  assert.equal(await page.locator('#result-container article').count(), 1, '空符号池后 L8 仍可生成');
  await page.locator('[data-password-length-preset="32"]').click();
  assert.equal(await page.locator('input[name="length"]').inputValue(), '32');
  assert.equal(await page.locator('[data-preset-slider="length"] .preset-slider-range').inputValue(), '7');
  assert.match(await page.locator('#complexity-description').textContent(), /自定义配置/u);
  const lengthSlider = page.locator('[data-preset-slider="length"] .preset-slider-range');
  await lengthSlider.focus();
  await lengthSlider.press('ArrowRight');
  assert.equal(await page.locator('input[name="length"]').inputValue(), '64', '长度滑块必须更新精确值');
  await page.locator('input[name="length"]').fill('37');
  assert.equal(await page.locator('input[name="length"]').inputValue(), '37');
  assert.equal(await page.locator('[data-preset-slider="length"] .preset-slider-range').inputValue(), '11');
  assert.equal(await page.locator('[data-preset-custom="length"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-preset-custom="length"]').click();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'length');
  await page.locator('[data-password-quantity-preset="25"]').click();
  assert.equal(await page.locator('input[name="quantity"]').inputValue(), '25');
  assert.equal(await page.locator('[data-preset-slider="quantity"] .preset-slider-range').inputValue(), '4');
  const quantitySlider = page.locator('[data-preset-slider="quantity"] .preset-slider-range');
  await quantitySlider.focus();
  await quantitySlider.press('Home');
  assert.equal(await page.locator('input[name="quantity"]').inputValue(), '1', '数量滑块必须更新精确值');
  await quantitySlider.press('End');
  assert.equal(await page.locator('input[name="quantity"]').inputValue(), '1', '数量自定义刻度不得篡改精确值');
  assert.equal(await page.locator('[data-preset-custom="quantity"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-preset-custom="quantity"]').click();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'quantity');
  const complexitySlider = page.locator('[data-preset-slider="complexity"] .preset-slider-range');
  await complexitySlider.focus();
  await complexitySlider.press('Home');
  assert.equal(await page.locator('input[name="length"]').inputValue(), '4');
  assert.equal(await page.locator('[data-complexity-level="L1"]').getAttribute('aria-pressed'), 'true');
  await page.locator('input[name="uppercaseLetters"]').check();
  assert.equal(await page.locator('input[name="complexityPreset"]').inputValue(), 'custom');
  assert.equal(await page.locator('[data-preset-slider="complexity"] .preset-slider-mark.is-active').count(), 0);
  assert.match(await complexitySlider.getAttribute('aria-valuetext'), /自定义配置/u);
  await page.getByRole('button', { name: '恢复默认' }).click();
  assert.equal(await page.locator('input[name="length"]').inputValue(), '20');
  assert.equal(await page.locator('input[name="quantity"]').inputValue(), '1');
  assert.equal(await page.locator('[data-complexity-level="L8"]').getAttribute('aria-pressed'), 'true');

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
  assert.equal(await page.evaluate(() => globalThis.__v21Clipboard.length), 0, '生成不得自动复制');

  await page.locator('.mode-link[data-mode="password"]').click();
  await clickGenerate(page);
  const resultCard = page.locator('#result-container .result-card').first();
  const toggleButton = resultCard.locator('[data-secret-toggle]');
  await toggleButton.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const beforeToggle = await resultCard.boundingBox();
  const beforePageScroll = await page.evaluate(() => scrollY);
  const beforeScrollTop = await page.locator('.result-scroll').evaluate((node) => node.scrollTop);
  await toggleButton.click();
  const afterHide = await resultCard.boundingBox();
  assert.deepEqual(afterHide, beforeToggle, '隐藏内容不得改变结果卡几何位置');
  assert.equal(await page.evaluate(() => scrollY), beforePageScroll, '隐藏内容不得晃动页面滚动位置');
  assert.equal(await page.locator('.result-scroll').evaluate((node) => node.scrollTop), beforeScrollTop);
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
  const pinBatch = await page.evaluate(() => globalThis.__v21Clipboard.at(-1).split('\n'));
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

  const sentinel = 'V21_SECRET_SENTINEL_9f8a7c6b5d4e';
  await page.locator('.mode-link[data-mode="token"]').click();
  await page.locator('#history-toggle').check();
  assert.equal(await page.locator('#history-panel').getAttribute('open'), null, '折叠状态下可以直接启用记录');
  await page.locator('#history-panel > summary').click();
  assert.equal(await page.locator('#history-panel').getAttribute('open'), '');
  await page.locator('input[name="prefix"]').fill(`${sentinel}_`);
  await clickGenerate(page);
  await page.locator('input[name="prefix"]').fill('');
  assert.match(await page.locator('#result-container .secret-value').textContent(), new RegExp(sentinel), '当前结果默认显示明文');
  assert.equal(await page.locator('.history-row').count(), 1);
  assert.equal(await page.locator('.history-type').count(), 0, '记录列表不再重复显示类型文案');
  const historyPreview = page.locator('.history-preview').first();
  assert.equal(await historyPreview.evaluate((node) => getComputedStyle(node).whiteSpace), 'nowrap');
  const previewStyle = await historyPreview.evaluate((node) => ({ border: getComputedStyle(node).borderStyle, background: getComputedStyle(node).backgroundColor }));
  assert.equal(previewStyle.border, 'none', '记录值本身不显示边框');
  assert.equal(previewStyle.background, 'rgba(0, 0, 0, 0)', '记录值本身不显示底色');
  assert.equal(await page.locator('.history-icon-button').count(), 2, '复制和删除均使用图标按钮');
  assert.equal((await page.locator('.history-copy-button').textContent()).trim(), '');
  assert.equal((await page.locator('.history-delete-button').textContent()).trim(), '');
  await page.setViewportSize({ width: 390, height: 844 });
  await historyPreview.scrollIntoViewIfNeeded();
  await historyPreview.hover();
  const historyTooltip = page.locator('.history-tooltip');
  assert.match(await historyTooltip.textContent(), new RegExp(sentinel));
  assert.equal(await historyTooltip.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + (rect.width / 2);
    const y = rect.top + (rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return rect.width > 0 && rect.height > 0
      && rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
      && (hit === node || node.contains(hit));
  }), true, '完整值气泡必须位于视口内且实际可见，不得只存在于 DOM');
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => !document.querySelector('.history-tooltip'));
  await historyPreview.click();
  assert.match(await page.evaluate(() => globalThis.__v21Clipboard.at(-1)), new RegExp(sentinel));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#copy-share').click();
  const shareText = await page.evaluate(() => globalThis.__v21Clipboard.at(-1));
  assert.match(shareText, /V2\.1/u);
  assert.match(shareText, /https:\/\/betaer\.github\.io\/password-generator\/index-2\.1\.html/u);
  assert.equal(shareText.includes(sentinel), false, '网站分享文案不得包含生成结果');
  assert.equal(await page.locator('.site-floating-star-badge').textContent(), '999+');
  await page.waitForTimeout(1000);
  assert.ok(gaRequests.length >= 1, `GA collect request must be observed; Google requests: ${googleRequestUrls.join(', ')}`);
  for (const request of gaRequests) {
    const combined = `${request.url}\n${request.body}\n${JSON.stringify(request.headers)}`;
    assert.equal(combined.includes(sentinel), false);
    assert.equal(request.headers.cookie, undefined);
    const url = new URL(request.url);
    assert.equal(url.searchParams.get('dl'), 'https://betaer.github.io/password-generator/index-2.1.html');
    assert.equal(url.searchParams.get('dr'), '');
    assert.equal(url.searchParams.get('dp'), '/password-generator/index-2.1.html');
  }
  await page.locator('.history-row').first().getByRole('button', { name: '删除第 1 条生成记录' }).click();
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
  assert.equal(await page.locator('[data-v21-clipboard-fallback]').count(), 0);
  assert.match(await page.locator('#toast').textContent(), /forced copy failure|复制/u);

  await page.locator('.mode-link[data-mode="uuid"]').click();
  await page.locator('select[name="version"]').selectOption('7');
  await page.getByRole('button', { name: '恢复默认' }).click();
  await page.waitForFunction(() => document.querySelector('select[name="version"]')?.value === '4');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  assert.equal(await page.locator('select[name="version"]').inputValue(), '4');

  await page.locator('.mode-link[data-mode="password"]').click();

  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal overflow at ${viewport.width}`);
    const historyTopOverlap = await page.evaluate(() => {
      const title = document.getElementById('history-title').getBoundingClientRect();
      const actions = document.querySelector('.history-top-actions').getBoundingClientRect();
      return actions.left < title.right && actions.right > title.left;
    });
    assert.equal(historyTopOverlap, false, `${viewport.width}px 记录顶栏标题与开关不得重叠`);
    if (viewport.width <= 430) {
      for (const kind of ['complexity', 'length', 'quantity']) {
        const range = page.locator(`[data-preset-slider="${kind}"] .preset-slider-range`);
        await range.focus();
        await range.press('Home');
        const firstMarkVisible = await page.locator(`[data-preset-slider="${kind}"]`).evaluate((root) => {
          const scrollArea = root.querySelector('.preset-slider-scroll');
          const firstMark = root.querySelector('.preset-slider-mark:first-child');
          const scrollRect = scrollArea.getBoundingClientRect();
          const markRect = firstMark.getBoundingClientRect();
          return markRect.left >= scrollRect.left && markRect.right <= scrollRect.right;
        });
        assert.equal(firstMarkVisible, true, `${kind} first mark must remain fully visible on mobile`);
        await range.press('End');
        const sliderState = await page.locator(`[data-preset-slider="${kind}"]`).evaluate((root) => {
          const scrollArea = root.querySelector('.preset-slider-scroll');
          const lastMark = root.querySelector('.preset-slider-mark:last-child');
          const scrollRect = scrollArea.getBoundingClientRect();
          const markRect = lastMark.getBoundingClientRect();
          return {
            scrollable: scrollArea.scrollWidth > scrollArea.clientWidth,
            lastMarkVisible: markRect.left >= scrollRect.left && markRect.right <= scrollRect.right,
            allMarksVisible: [...root.querySelectorAll('.preset-slider-mark')].every((mark) => {
              const rect = mark.getBoundingClientRect();
              return rect.left >= scrollRect.left && rect.right <= scrollRect.right;
            }),
          };
        });
        assert.equal(sliderState.scrollable, kind !== 'complexity', `${kind} mobile slider scrolling contract`);
        if (kind === 'complexity') {
          assert.equal(sliderState.allMarksVisible, true, '移动端复杂度必须一次展示完整的 L1～L8');
        }
        assert.equal(sliderState.lastMarkVisible, true, `${kind} last mark must remain fully visible on mobile`);
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const horizontalSliderGeometry = await page.evaluate(() => {
    document.querySelectorAll('.preset-slider-scroll').forEach((node) => { node.scrollLeft = 0; });
    const geometry = (kind) => {
      const root = document.querySelector(`[data-preset-slider="${kind}"]`);
      const scrollNode = root.querySelector('.preset-slider-scroll');
      const label = root.querySelector('.preset-slider-label').getBoundingClientRect();
      const scroll = scrollNode.getBoundingClientRect();
      const exact = root.querySelector('.preset-exact-input')?.getBoundingClientRect() || null;
      const input = root.querySelector('.preset-exact-input input')?.getBoundingClientRect() || null;
      const unit = root.querySelector('[data-exact-unit]')?.getBoundingClientRect() || null;
      const custom = root.querySelector('.preset-slider-custom')?.getBoundingClientRect() || null;
      return { label, scroll, exact, input, unit, custom, scrollable: scrollNode.scrollWidth > scrollNode.clientWidth };
    };
    return {
      configWidth: document.querySelector('.config-panel').getBoundingClientRect().width,
      complexity: geometry('complexity'),
      length: geometry('length'),
      quantity: geometry('quantity'),
    };
  });
  assert.ok(horizontalSliderGeometry.configWidth >= 860 && horizontalSliderGeometry.configWidth <= 900, '1280px 桌面端配置面板必须使用紧凑宽度');
  const sliderLefts = ['complexity', 'length', 'quantity'].map((kind) => horizontalSliderGeometry[kind].scroll.left);
  assert.ok(Math.max(...sliderLefts) - Math.min(...sliderLefts) <= 1, '三条进度条必须共用相同起始线');
  for (const kind of ['complexity', 'length', 'quantity']) {
    const state = horizontalSliderGeometry[kind];
    assert.ok(state.scroll.left - state.label.right >= 12 && state.scroll.left - state.label.right <= 16, `${kind} 标签与进度条之间不得保留过宽空白`);
  }
  for (const kind of ['length', 'quantity']) {
    const state = horizontalSliderGeometry[kind];
    assert.equal(state.scrollable, false, `${kind} 在 1280px 桌面端必须完整展示全部快捷数值与自定义刻度`);
    assert.ok(state.scroll.right <= state.exact.left, `${kind} 自定义输入必须位于进度条右侧`);
    assert.ok(state.exact.top < state.scroll.bottom && state.exact.bottom > state.scroll.top, `${kind} 自定义输入必须与进度条同排`);
    assert.ok(state.custom.right <= state.scroll.right + 1, `${kind} 自定义刻度不得被右侧裁切`);
    assert.ok(state.custom.right < state.input.left, `${kind} 自定义刻度必须位于输入框之前`);
    assert.ok(state.exact.width <= 156, `${kind} 精确值区域必须保持紧凑`);
    assert.ok(state.input.width <= 128, `${kind} 精确值输入框不得占用过宽空间`);
    assert.ok(state.unit.left - state.input.right >= 0 && state.unit.left - state.input.right <= 12, `${kind} 单位必须紧邻输入框`);
    assert.ok(Math.abs((state.unit.top + state.unit.bottom) / 2 - (state.input.top + state.input.bottom) / 2) <= 2, `${kind} 单位与输入框必须垂直居中`);
  }
  assert.equal(await page.getByText('精确值', { exact: true }).count(), 0, '老版横向样式不显示额外“精确值”标题');
  const complexityMarksVisible = await page.locator('[data-preset-slider="complexity"]').evaluate((root) => {
    const scrollRect = root.querySelector('.preset-slider-scroll').getBoundingClientRect();
    return [...root.querySelectorAll('.preset-slider-mark')].every((mark) => {
      const markRect = mark.getBoundingClientRect();
      return markRect.left >= scrollRect.left - 1 && markRect.right <= scrollRect.right + 1;
    });
  });
  assert.equal(complexityMarksVisible, true, '桌面配置栏必须同时展示完整的 L1～L8');
  for (const viewportWidth of [780, 781, 900, 901, 1160, 1161]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    const boundaryState = await page.evaluate(() => {
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      const mode = document.querySelector('.mode-panel').getBoundingClientRect();
      const config = document.querySelector('.config-panel').getBoundingClientRect();
      const layout = document.querySelector('[data-preset-slider="length"] .preset-slider-layout');
      const scroll = layout.querySelector('.preset-slider-scroll').getBoundingClientRect();
      const exact = layout.querySelector('.preset-exact-input').getBoundingClientRect();
      return {
        workspace,
        mode,
        config,
        scroll,
        exact,
        singleColumn: Math.abs(config.left - workspace.left) <= 1,
        exactBelow: exact.top >= scroll.bottom,
      };
    });
    assert.equal(boundaryState.singleColumn, viewportWidth <= 1160, `${viewportWidth}px 导航与配置布局边界`);
    assert.equal(boundaryState.exactBelow, viewportWidth <= 900, `${viewportWidth}px 精确输入换行边界`);
    assert.ok(boundaryState.scroll.width >= 460, `${viewportWidth}px 进度条必须保留足够可视宽度`);
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => scrollTo(0, 0));
  const threeColumnGeometry = await page.evaluate(() => {
    const config = document.querySelector('.config-panel').getBoundingClientRect();
    const result = document.querySelector('.result-panel').getBoundingClientRect();
    return { config, result };
  });
  assert.ok(threeColumnGeometry.config.width >= 780 && threeColumnGeometry.config.width <= 820, '1600px 桌面端必须收窄中间策略配置列');
  assert.ok(threeColumnGeometry.result.width >= 390, '1600px 桌面端必须为生成结果保留独立可读列');
  assert.ok(Math.abs(threeColumnGeometry.config.top - threeColumnGeometry.result.top) <= 1, '1600px 桌面端配置与结果必须并排顶对齐');
  await page.setViewportSize({ width: 960, height: 900 });
  for (const kind of ['length', 'quantity']) {
    const layoutState = await page.locator(`[data-preset-slider="${kind}"] .preset-slider-layout`).evaluate((layout) => {
      const scrollArea = layout.querySelector('.preset-slider-scroll');
      const exactInput = layout.querySelector('.preset-exact-input');
      const scrollRect = scrollArea.getBoundingClientRect();
      const exactRect = exactInput.getBoundingClientRect();
      return {
        separatedHorizontally: scrollRect.right <= exactRect.left,
        wrappedBelow: exactRect.top >= scrollRect.bottom,
      };
    });
    assert.equal(
      layoutState.separatedHorizontally || layoutState.wrappedBelow,
      true,
      `${kind} exact input must not overlap or clip the slider viewport`,
    );
  }
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => !document.getElementById('back-to-top').hidden);
  await page.locator('#back-to-top').click();
  assert.equal(await page.evaluate(() => scrollY), 0, '回到顶部使用即时滚动');
  assert.deepEqual(pageErrors, []);
  await context.close();

  const layoutContext = await browser.newContext();
  await layoutContext.route(/google-analytics\.com|googletagmanager\.com/u, (route) => route.fulfill({ status: 204, body: '' }));
  const layoutPage = await layoutContext.newPage();
  await layoutPage.goto(`${baseUrl}/index-2.1.html#password`, { waitUntil: 'domcontentloaded' });
  await waitReady(layoutPage);
  await layoutPage.setViewportSize({ width: 1280, height: 900 });
  const initialSliderGeometry = await layoutPage.evaluate(() => {
    const snapshot = (kind) => {
      const root = document.querySelector(`[data-preset-slider="${kind}"]`);
      const scrollNode = root.querySelector('.preset-slider-scroll');
      const scroll = scrollNode.getBoundingClientRect();
      const custom = root.querySelector('.preset-slider-custom')?.getBoundingClientRect() || null;
      const input = root.querySelector('.preset-exact-input input')?.getBoundingClientRect() || null;
      const unit = root.querySelector('[data-exact-unit]')?.getBoundingClientRect() || null;
      return { scroll, custom, input, unit, scrollable: scrollNode.scrollWidth > scrollNode.clientWidth };
    };
    return { length: snapshot('length'), quantity: snapshot('quantity') };
  });
  for (const kind of ['length', 'quantity']) {
    const state = initialSliderGeometry[kind];
    assert.equal(state.scrollable, false, `${kind} 初始状态必须完整显示全部刻度`);
    assert.ok(state.custom.right <= state.scroll.right + 1, `${kind} 初始自定义刻度不得裁切`);
    assert.ok(state.custom.right < state.input.left, `${kind} 初始自定义刻度必须位于输入框之前`);
    assert.ok(state.unit.left >= state.input.right && state.unit.left - state.input.right <= 12, `${kind} 初始单位必须紧邻输入框`);
  }
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 430, height: 900 },
    { width: 780, height: 900 },
    { width: 781, height: 900 },
    { width: 900, height: 900 },
    { width: 901, height: 900 },
    { width: 960, height: 900 },
    { width: 1160, height: 900 },
    { width: 1161, height: 900 },
    { width: 1280, height: 900 },
    { width: 1500, height: 900 },
    { width: 1560, height: 900 },
    { width: 1561, height: 900 },
    { width: 1600, height: 900 },
    { width: 2138, height: 1000 },
    { width: 2560, height: 1200 },
  ]) {
    await layoutPage.setViewportSize(viewport);
    for (const position of ['top', 'bottom']) {
      await layoutPage.evaluate((target) => scrollTo(0, target === 'top' ? 0 : document.documentElement.scrollHeight), position);
      await layoutPage.waitForTimeout(40);
      const state = await layoutPage.evaluate(() => {
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const floating = [...document.querySelectorAll('.site-floating-actions button, .site-floating-actions a')].filter(visible);
        const targets = [...document.querySelectorAll('main button, main a, main input, main select, main summary')]
          .filter((node) => !node.closest('.site-floating-actions') && visible(node));
        const overlaps = [];
        for (const action of floating) {
          const actionRect = action.getBoundingClientRect();
          for (const target of targets) {
            const targetRect = target.getBoundingClientRect();
            const width = Math.min(actionRect.right, targetRect.right) - Math.max(actionRect.left, targetRect.left);
            const height = Math.min(actionRect.bottom, targetRect.bottom) - Math.max(actionRect.top, targetRect.top);
            if (width > 1 && height > 1) overlaps.push(`${action.getAttribute('aria-label')} -> ${target.getAttribute('aria-label') || target.textContent.trim().slice(0, 28)}`);
          }
        }
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          actionPosition: getComputedStyle(document.querySelector('.site-floating-actions')).position,
          configOffsetLeft: document.querySelector('.config-panel').offsetLeft,
          resultOffsetLeft: document.querySelector('.result-panel').offsetLeft,
          overlaps,
        };
      });
      assert.equal(state.overflow, false, `${viewport.width}px ${position} 不得横向溢出`);
      assert.deepEqual(state.overlaps, [], `${viewport.width}px ${position} 浮动操作不得遮挡交互元素`);
      assert.equal(state.actionPosition, viewport.width <= 780 ? 'static' : 'fixed', `${viewport.width}px 快捷操作定位策略`);
      assert.equal(state.resultOffsetLeft > state.configOffsetLeft, viewport.width > 1560, `${viewport.width}px ${position} 策略与结果面板响应式排布`);
    }
  }
  await layoutContext.close();

  const noCryptoContext = await browser.newContext();
  await noCryptoContext.addInitScript(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} }); });
  const noCryptoPage = await noCryptoContext.newPage();
  await noCryptoPage.goto(`${baseUrl}/index-2.1.html`, { waitUntil: 'domcontentloaded' });
  await noCryptoPage.waitForFunction(() => document.documentElement.dataset.passwordGeneratorReady === 'true');
  assert.equal(await noCryptoPage.locator('#generate-button').isDisabled(), true);
  assert.match(await noCryptoPage.locator('#crypto-status-chip').textContent(), /已停止/u);
  await noCryptoContext.close();

  process.stdout.write('V2.1 browser verification passed: BIP39 readiness, three synchronized preset sliders, embedded History, nine profiles, privacy, GA isolation, and responsive layouts.\n');
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
