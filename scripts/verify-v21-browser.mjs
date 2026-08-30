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
  await context.route('https://x.com/Betaer', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Betaer on X</title>' }));

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/index-2.1.html?from=compat#pin`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${baseUrl}/index.html?from=compat#pin`);
  assert.equal((await context.request.get(`${baseUrl}/index-2.0.html`)).status(), 404, 'V2.0 旧入口必须下线');
  assert.equal((await context.request.get(`${baseUrl}/v2.01.html`)).status(), 404, 'V2.0.1 旧入口必须下线');
  await page.goto(`${baseUrl}/index.html#password`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.resource-item')]
    .some((item) => item.textContent.includes('BIP39 英语 · 已就绪')));
  assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://betaer.github.io/password-generator/index.html');
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
  assert.equal(await page.locator('select[name="startsWith"]').inputValue(), 'letter', '首字符默认使用字母');
  assert.equal(await page.locator('select[name="endsWith"]').inputValue(), 'letter', '尾字符默认使用字母');
  assert.equal(await page.getByRole('checkbox', { name: '空格', exact: true }).count(), 1);
  assert.equal(await page.getByRole('checkbox', { name: '内部空格', exact: true }).count(), 0);
  await page.locator('[data-complexity-level="L2"]').click();
  const sliderAlignment = await page.evaluate(() => [...document.querySelectorAll('[data-preset-slider]')].map((root) => {
    const range = root.querySelector('.preset-slider-range');
    const track = root.querySelector('.preset-slider-track');
    const markRow = root.querySelector('.preset-slider-mark-row');
    const activeMark = root.querySelector('.preset-slider-mark.is-active');
    const rangeRect = range.getBoundingClientRect();
    const markRect = activeMark.getBoundingClientRect();
    const rangeStyle = getComputedStyle(range);
    const markRowStyle = getComputedStyle(markRow);
    const activeTickStyle = getComputedStyle(activeMark, '::before');
    const thumbSize = Number.parseFloat(getComputedStyle(track).getPropertyValue('--slider-thumb-size'));
    const minimum = Number(range.min || 0);
    const maximum = Number(range.max || 100);
    const progress = (Number(range.value) - minimum) / (maximum - minimum);
    const thumbCenter = rangeRect.left + (thumbSize / 2) + (progress * (rangeRect.width - thumbSize));
    const markCenter = markRect.left + (markRect.width / 2);
    return {
      kind: root.dataset.presetSlider,
      delta: Math.abs(markCenter - thumbCenter),
      rangeLayer: Number(rangeStyle.zIndex),
      markLayer: Number(markRowStyle.zIndex),
      tickColor: activeTickStyle.backgroundColor,
      tickWidth: Number.parseFloat(activeTickStyle.width),
    };
  }));
  assert.deepEqual(sliderAlignment.map(({ kind }) => kind), ['complexity', 'length', 'quantity']);
  for (const state of sliderAlignment) {
    assert.ok(state.delta <= 0.5, `${state.kind} 滑块圆心与选中刻度中心必须精确对齐，当前偏差 ${state.delta}px`);
    assert.ok(state.rangeLayer > state.markLayer, `${state.kind} 滑块必须位于刻度线之上`);
    assert.equal(state.tickColor, 'rgb(174, 191, 184)', `${state.kind} 选中刻度线必须保持灰色`);
    assert.equal(state.tickWidth, 1, `${state.kind} 选中刻度线不得加粗`);
  }
  await page.locator('input[name="symbolPool"]').fill('');
  await page.locator('[data-complexity-level="L1"]').click();
  assert.equal(await page.locator('input[name="length"]').inputValue(), '4');
  assert.equal(await page.locator('input[name="digits"]').isChecked(), false);
  assert.equal(await page.locator('input[name="lowercase"]').isChecked(), true);
  assert.equal(await page.locator('select[name="startsWith"]').inputValue(), 'letter');
  assert.equal(await page.locator('select[name="endsWith"]').inputValue(), 'letter');
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

  await page.locator('input[name="quantity"]').fill('5');
  await clickGenerate(page);
  assert.equal(await page.locator('.compact-result-row').count(), 5, '批量结果必须使用五条紧凑行');
  assert.equal(await page.locator('.result-card').count(), 0, '不得继续为每条结果渲染完整安全卡');
  assert.equal(await page.locator('[data-batch-assessment]').count(), 1, '同一批次只有一份公共安全说明');
  const batchAssessment = page.locator('[data-batch-assessment]');
  assert.equal(await batchAssessment.getByText('精确生成器指标', { exact: true }).count(), 1);
  assert.equal(await batchAssessment.getByText('攻击场景估算', { exact: true }).count(), 1);
  assert.equal(await batchAssessment.getByText('生成模型详情', { exact: true }).count(), 1);
  const firstInfo = page.getByRole('button', { name: /^第 1 条观察模式：/u });
  await page.setViewportSize({ width: 390, height: 844 });
  await firstInfo.hover();
  assert.equal(await firstInfo.getAttribute('title'), null, '观察模式图标只显示自定义气泡，不得叠加浏览器原生 title');
  const patternTooltip = page.locator('.compact-result-row').first().locator(':scope > .result-tooltip');
  assert.equal(await patternTooltip.isVisible(), true, '观察模式气泡必须真正可见');
  const patternTooltipGeometry = await patternTooltip.evaluate((tooltip) => {
    const tip = tooltip.getBoundingClientRect();
    const scroll = tooltip.closest('.result-scroll').getBoundingClientRect();
    return {
      tip: { left: tip.left, right: tip.right, top: tip.top, bottom: tip.bottom },
      scroll: { left: scroll.left, right: scroll.right, top: scroll.top, bottom: scroll.bottom },
      contentClipped: tooltip.scrollWidth > tooltip.clientWidth || tooltip.scrollHeight > tooltip.clientHeight,
    };
  });
  assert.ok(patternTooltipGeometry.tip.left >= patternTooltipGeometry.scroll.left - 1, '观察模式气泡左侧不得被裁切');
  assert.ok(patternTooltipGeometry.tip.right <= patternTooltipGeometry.scroll.right + 1, '观察模式气泡右侧不得被裁切');
  assert.equal(patternTooltipGeometry.contentClipped, false, '观察模式气泡文案必须完整显示');
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await firstInfo.click();
  assert.equal(await page.locator('.compact-result-row').first().locator(':scope > .result-pattern-tooltip').count(), 1);
  await firstInfo.click();
  assert.equal(await page.locator('.compact-result-row').first().locator(':scope > .result-pattern-tooltip').count(), 0);
  const batchInfo = page.getByRole('button', { name: '批次级安全分析说明' });
  await batchInfo.hover();
  const batchTooltip = batchAssessment.locator('[role="tooltip"]');
  assert.equal(await batchTooltip.count(), 1, '悬停批次说明图标必须创建一份气泡');
  assert.equal(await batchTooltip.isVisible(), true, '批次说明气泡必须在折叠状态下真正可见');
  assert.match(await batchTooltip.textContent(), /同一批次使用同一份冻结配置与生成模型/u);
  await page.mouse.move(0, 0);
  assert.equal(await batchTooltip.count(), 0, '移开鼠标后批次说明气泡必须关闭');
  await batchInfo.click();
  assert.equal(await batchAssessment.getAttribute('open'), null, '点击说明气泡不得误展开批次详情');
  assert.equal(await batchTooltip.count(), 1);
  assert.equal(await batchTooltip.isVisible(), true, '点击或键盘聚焦后的批次说明气泡也必须可见');
  await batchInfo.click();
  await batchAssessment.locator(':scope > summary').click();
  const modelDetails = batchAssessment.locator('.model-details');
  await modelDetails.locator('summary').click();
  await firstInfo.focus();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-pattern-indicator]')]
    .every((node) => ['ready', 'error', 'degraded', 'unavailable'].includes(node.dataset.state)));
  assert.equal(await firstInfo.evaluate((node) => document.activeElement === node), true, '异步模式分析更新不得夺走当前焦点');
  assert.equal(await batchAssessment.getAttribute('open'), '', '异步模式分析更新不得折叠批次安全说明');
  assert.equal(await modelDetails.getAttribute('open'), '', '异步模式分析更新不得折叠生成模型详情');
  assert.equal(await page.locator('.result-pattern-indicator .result-pattern-indicator').count(), 0, '模式分析不得嵌套重复提示节点');
  assert.doesNotMatch(await page.locator('.compact-result-row').first().locator(':scope > .result-pattern-tooltip').textContent(), /正在|分析中/u, '已打开的观察模式气泡必须随异步结果原位更新');
  await modelDetails.locator('summary').click();
  await batchAssessment.locator(':scope > summary').click();
  const compactViewport = await page.evaluate(() => {
    const scroll = document.querySelector('.result-scroll').getBoundingClientRect();
    const third = document.querySelectorAll('.compact-result-row')[2].getBoundingClientRect();
    return { visibleRows: [...document.querySelectorAll('.compact-result-row')].filter((row) => row.getBoundingClientRect().bottom <= scroll.bottom + 1).length, thirdBottom: third.bottom, scrollBottom: scroll.bottom };
  });
  assert.ok(compactViewport.visibleRows >= 3, `结果首屏必须看见至少三条，当前 ${compactViewport.visibleRows} 条`);
  const firstCopyAction = page.locator('.compact-result-row').first().getByRole('button', { name: '复制第 1 条生成结果' }).last();
  await firstCopyAction.hover();
  assert.equal(await page.locator('.compact-result-actions > .result-tooltip').textContent(), '复制第 1 条生成结果');
  await page.mouse.move(0, 0);

  const beforeRegenerate = await page.locator('.compact-result-row').evaluateAll((rows) => rows.map((row) => ({
    id: row.dataset.resultId,
    value: row.querySelector('.compact-result-value')?.textContent,
  })));
  const clipboardBeforeRegenerate = await page.evaluate(() => globalThis.__v21Clipboard.length);
  await page.locator('.compact-result-row').nth(1).locator('[data-regenerate-result]').click();
  await page.waitForFunction((previousId) => document.querySelectorAll('.compact-result-row')[1]?.dataset.resultId !== previousId, beforeRegenerate[1].id);
  const afterRegenerate = await page.locator('.compact-result-row').evaluateAll((rows) => rows.map((row) => ({
    id: row.dataset.resultId,
    value: row.querySelector('.compact-result-value')?.textContent,
  })));
  assert.equal(afterRegenerate.length, beforeRegenerate.length);
  assert.notEqual(afterRegenerate[1].id, beforeRegenerate[1].id, '只替换目标行 id');
  assert.notEqual(afterRegenerate[1].value, beforeRegenerate[1].value, '只替换目标行值');
  for (const index of [0, 2, 3, 4]) assert.deepEqual(afterRegenerate[index], beforeRegenerate[index], `第 ${index + 1} 行保持不变`);
  assert.equal(await page.evaluate(() => globalThis.__v21Clipboard.length), clipboardBeforeRegenerate, '单条重新生成不得写入 Clipboard');
  if (process.env.V21_QA_SCREENSHOT) {
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 413, height: 980 });
    await page.locator('.result-panel').screenshot({ path: resolve(ROOT, process.env.V21_QA_SCREENSHOT) });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  await page.getByRole('button', { name: '恢复默认' }).click();
  await clickGenerate(page);
  assert.equal(await page.locator('.compact-result-row').count(), 1);

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
  const modeMetaPatterns = new Map([
    ['password', /位 · 小写/u],
    ['passphrase', /个词/u],
    ['pin', /位 · 批内唯一/u],
    ['mnemonic', /ENT \d+ \/ CS \d+ 比特/u],
    ['token', /个随机位/u],
    ['apiSecret', /个随机位/u],
    ['hex', /个随机位/u],
    ['randomBytes', /字节 · .*SHA-256/u],
    ['uuid', /标识符，不是秘密/u],
  ]);
  assert.equal(await page.locator('#mode-panel-title').textContent(), '1、选择生成类型');
  for (const [mode, [zh, en, configTitle, resultTitle]] of modeLabels) {
    const modeButton = page.locator(`.mode-link[data-mode="${mode}"]`);
    assert.equal(await modeButton.locator('.mode-label-zh').textContent(), zh);
    assert.equal(await modeButton.locator('.mode-label-en').textContent(), en);
    await modeButton.click();
    if (mode === 'mnemonic') await page.locator('input[name="mnemonicAck"]').check();
    await waitReady(page);
    await page.locator('input[name="quantity"]').fill('3');
    await clickGenerate(page);
    assert.equal(await page.locator('#result-container article').count(), 3, `${mode} 必须以三条紧凑行展示批量结果`);
    assert.equal(await page.locator('[data-batch-assessment]').count(), 1, `${mode} 批次只显示一份公共安全说明`);
    assert.equal(await page.locator('#config-title').textContent(), configTitle);
    assert.equal(await page.locator('#result-title').textContent(), resultTitle);
    const expectedType = mode === 'apiSecret' ? 'api-secret' : mode === 'randomBytes' ? 'random-bytes' : mode;
    assert.equal(await page.locator('#result-container .compact-result-row').first().getAttribute('data-result-type'), expectedType);
    assert.doesNotMatch(await page.locator('#result-container .compact-result-value').first().textContent(), /^•+$/u);
    assert.match(await page.locator('#result-container .compact-result-meta').first().textContent(), modeMetaPatterns.get(mode));
    assert.match(await page.locator('#result-container').textContent(), /精确生成器指标/u);
    assert.equal(await page.locator('[data-regenerate-result]').count(), 3, `${mode} 每条都可独立重新生成`);
    assert.equal(await page.locator('[data-secret-toggle]').count(), 3, `${mode} 每条都可原位隐藏`);
    assert.equal(await page.locator('.result-delete-button').count(), 3, `${mode} 每条都可独立删除`);
    assert.equal(await page.getByRole('button', { name: /^复制第 \d+ 条生成结果$/u }).count(), 6, `${mode} 值与图标均可显式复制`);
    assert.equal(await page.locator('[data-pattern-indicator]').count(), ['password', 'passphrase'].includes(mode) ? 3 : 0, `${mode} 只显示适用的逐条模式提示`);
    if (mode === 'randomBytes') {
      assert.equal(await page.locator('.compact-download-button').count(), 3, '每条随机字节都可下载');
      const beforeId = await page.locator('.compact-result-row').first().getAttribute('data-result-id');
      const beforeMeta = await page.locator('.compact-result-meta').first().textContent();
      await page.locator('.compact-result-row').first().locator('[data-regenerate-result]').click();
      await page.waitForFunction((id) => document.querySelector('.compact-result-row')?.dataset.resultId !== id, beforeId);
      assert.notEqual(await page.locator('.compact-result-meta').first().textContent(), beforeMeta, '随机字节重生成必须更新 SHA-256 摘要');
    }
  }
  assert.equal(await page.evaluate(() => globalThis.__v21Clipboard.length), 0, '生成不得自动复制');

  await page.locator('.mode-link[data-mode="password"]').click();
  await clickGenerate(page);
  const resultCard = page.locator('#result-container .compact-result-row').first();
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
  assert.equal(await resultCard.locator('.compact-result-value').getAttribute('data-secret-state'), 'masked');
  assert.match(await resultCard.locator('.compact-result-value').evaluate((node) => getComputedStyle(node, '::before').content), /•+/u);
  assert.equal(await toggleButton.evaluate((node) => document.activeElement === node), true, '切换后保持键盘焦点');
  assert.equal(await resultCard.evaluate((node) => getComputedStyle(node).animationName), 'none');
  const hiddenSecret = await resultCard.locator('.compact-result-value').textContent();
  await resultCard.locator('.compact-result-value').hover();
  const hiddenTooltipText = await resultCard.locator(':scope > .result-tooltip').textContent();
  assert.match(hiddenTooltipText, /内容已隐藏/u);
  assert.equal(hiddenTooltipText.includes(hiddenSecret), false, '隐藏状态的 hover/focus 气泡不得泄露完整结果');
  await page.mouse.move(0, 0);
  await toggleButton.click();
  assert.deepEqual(await resultCard.boundingBox(), beforeToggle, '显示内容不得改变结果卡几何位置');
  assert.equal(await page.evaluate(() => scrollY), beforePageScroll, '显示内容不得晃动页面滚动位置');
  assert.equal(await resultCard.locator('.compact-result-value').getAttribute('data-secret-state'), 'revealed');

  const stableBeforeFailure = {
    id: await resultCard.getAttribute('data-result-id'),
    value: await resultCard.locator('.compact-result-value').textContent(),
  };
  await page.evaluate(() => {
    globalThis.__v21RealWorker = globalThis.Worker;
    globalThis.Worker = class ForcedWorkerFailure {
      constructor() { throw new Error('V21_FORCED_REGENERATION_FAILURE'); }
    };
  });
  await resultCard.locator('[data-regenerate-result]').click();
  await page.waitForFunction(() => !document.querySelector('[data-regenerate-result]')?.disabled);
  assert.match(await page.locator('#toast').textContent(), /V21_FORCED_REGENERATION_FAILURE/u);
  assert.deepEqual({
    id: await page.locator('.compact-result-row').first().getAttribute('data-result-id'),
    value: await page.locator('.compact-result-value').first().textContent(),
  }, stableBeforeFailure, '单条重生成失败必须原子保留旧结果');
  await page.evaluate(() => { globalThis.Worker = globalThis.__v21RealWorker; delete globalThis.__v21RealWorker; });

  await page.locator('input[name="length"]').fill('4096');
  await clickGenerate(page);
  const cancelledRegenerationSecret = await page.locator('.compact-result-value').first().textContent();
  await page.evaluate(() => {
    globalThis.__v21RealWorker = globalThis.Worker;
    globalThis.Worker = class DelayedWorker {
      constructor(...args) {
        this.inner = new globalThis.__v21RealWorker(...args);
        this.messageHandler = null;
        this.errorHandler = null;
        this.inner.onmessage = (event) => setTimeout(() => this.messageHandler?.(event), 150);
        this.inner.onerror = (event) => this.errorHandler?.(event);
      }
      set onmessage(handler) { this.messageHandler = handler; }
      get onmessage() { return this.messageHandler; }
      set onerror(handler) { this.errorHandler = handler; }
      get onerror() { return this.errorHandler; }
      postMessage(...args) { this.inner.postMessage(...args); }
      terminate() { this.inner.terminate(); }
    };
  });
  await page.locator('.compact-result-row').first().locator('[data-regenerate-result]').click();
  await page.locator('.mode-link[data-mode="uuid"]').click();
  await page.waitForFunction(() => document.getElementById('config-title').textContent === 'UUID 标识符策略配置');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#result-container article').count(), 0, '切换模式取消单条重生成后不得复活旧结果');
  assert.equal((await page.locator('#result-container').textContent()).includes(cancelledRegenerationSecret), false, '已取消的 Password 秘密不得出现在 UUID 页面');
  await page.evaluate(() => { globalThis.Worker = globalThis.__v21RealWorker; delete globalThis.__v21RealWorker; });

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
  const pinCollisionMetric = page.locator('.metric').filter({ hasText: '独立批次碰撞概率' }).locator('.metric-value');
  const pinCollisionBefore = await pinCollisionMetric.textContent();
  const pinFirstId = await page.locator('.compact-result-row').first().getAttribute('data-result-id');
  await page.locator('.compact-result-row').first().locator('[data-regenerate-result]').click();
  await page.waitForFunction((id) => document.querySelector('.compact-result-row')?.dataset.resultId !== id, pinFirstId);
  const pinValuesAfterRegenerate = await page.locator('.compact-result-value').allTextContents();
  assert.equal(new Set(pinValuesAfterRegenerate).size, 100, '100 条 PIN 在单条重生成后仍须批内唯一');
  assert.equal(await pinCollisionMetric.textContent(), pinCollisionBefore, '单条重生成不得把原批次碰撞概率改写为数量 1 的模型');
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
  await page.locator('input[name="quantity"]').fill('1');
  await clickGenerate(page);
  await page.locator('input[name="prefix"]').fill('');
  assert.match(await page.locator('#result-container .compact-result-value').textContent(), new RegExp(sentinel), '当前结果默认显示明文');
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
  const tokenResultId = await page.locator('.compact-result-row').first().getAttribute('data-result-id');
  await page.locator('.compact-result-row').first().locator('[data-regenerate-result]').click();
  await page.waitForFunction((id) => document.querySelector('.compact-result-row')?.dataset.resultId !== id, tokenResultId);
  assert.equal(await page.locator('.history-row').count(), 2, '启用生成记录后，单条重生成保留旧值并写入新值');
  assert.equal((await page.locator('.history-preview').allTextContents()).every((value) => value.includes(sentinel)), true, '记录生命周期必须保留同一冻结配置的旧值与新值');
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
  assert.match(shareText, /https:\/\/betaer\.github\.io\/password-generator\/index\.html/u);
  assert.equal(shareText.includes(sentinel), false, '网站分享文案不得包含生成结果');
  assert.equal(await page.locator('.site-floating-star-badge').textContent(), '999+');
  const desktopFloatingSizes = await page.locator('.site-floating-github, .site-floating-x, .site-floating-copy').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  assert.equal(desktopFloatingSizes.length, 3);
  assert.deepEqual(desktopFloatingSizes, [
    { width: 124, height: 42 },
    { width: 124, height: 42 },
    { width: 124, height: 42 },
  ], '桌面端 GitHub、X 与复制分享必须保持等宽完整文字按钮');
  const xLink = page.getByRole('link', { name: '在 X 关注 Betaer' });
  assert.equal(await xLink.getAttribute('href'), 'https://x.com/Betaer');
  assert.equal(await xLink.getAttribute('target'), '_blank');
  assert.equal(await xLink.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await xLink.locator('.site-floating-button-label').isVisible(), true, '桌面端 X 文字必须可见');
  assert.equal(await xLink.locator('.site-floating-button-label').textContent(), '@Betaer', '桌面端 X 入口应显示账号名');
  const [xPopup] = await Promise.all([context.waitForEvent('page'), xLink.click()]);
  await xPopup.waitForLoadState('domcontentloaded');
  assert.equal(xPopup.url(), 'https://x.com/Betaer');
  await xPopup.close();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileXState = await xLink.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const label = node.querySelector('.site-floating-button-label');
    return { width: rect.width, height: rect.height, labelVisible: label.getBoundingClientRect().width > 1 || label.getBoundingClientRect().height > 1 };
  });
  assert.deepEqual(mobileXState, { width: 44, height: 44, labelVisible: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(1000);
  assert.ok(gaRequests.length >= 1, `GA collect request must be observed; Google requests: ${googleRequestUrls.join(', ')}`);
  for (const request of gaRequests) {
    const combined = `${request.url}\n${request.body}\n${JSON.stringify(request.headers)}`;
    assert.equal(combined.includes(sentinel), false);
    assert.equal(request.headers.cookie, undefined);
    const url = new URL(request.url);
    assert.equal(url.searchParams.get('dl'), 'https://betaer.github.io/password-generator/index.html');
    assert.equal(url.searchParams.get('dr'), '');
    assert.equal(url.searchParams.get('dp'), '/password-generator/index.html');
  }
  await page.locator('.history-row').first().getByRole('button', { name: '删除第 1 条生成记录' }).click();
  assert.equal(await page.locator('.history-row').count(), 1, '生成记录支持逐条删除且不影响另一条');
  await page.locator('#history-toggle').uncheck();
  assert.equal(await page.locator('.history-row').count(), 0, '关闭记录立即清除当前页面内存记录');

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
  assert.match(await randomBytesToggle.getAttribute('aria-label'), /^显示第 1 条/u);
  await randomBytesToggle.click();
  assert.match(await randomBytesToggle.getAttribute('aria-label'), /^隐藏第 1 条/u);
  assert.ok((await page.locator('#result-container .compact-result-value').textContent()).length < 200);
  assert.ok((await page.locator('#result-container').textContent()).length < 20_000);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = () => { throw new Error('forced copy failure'); };
  });
  await page.getByRole('button', { name: '复制第一条' }).click();
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
  await page.locator('input[name="length"]').fill('4096');
  await page.locator('input[name="quantity"]').fill('1');
  await clickGenerate(page);

  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal overflow at ${viewport.width}`);
    const longValue = page.locator('.compact-result-value').first();
    await longValue.hover();
    const longTooltipGeometry = await page.locator('.compact-result-row > .result-tooltip').evaluate((tooltip) => {
      const tip = tooltip.getBoundingClientRect();
      const scrollNode = tooltip.closest('.result-scroll');
      const scroll = scrollNode.getBoundingClientRect();
      return {
        tip: { top: tip.top, right: tip.right, bottom: tip.bottom, left: tip.left },
        scroll: { top: scroll.top, right: scroll.right, bottom: scroll.bottom, left: scroll.left },
        horizontalOverflow: scrollNode.scrollWidth > scrollNode.clientWidth,
      };
    });
    assert.ok(longTooltipGeometry.tip.left >= longTooltipGeometry.scroll.left - 1, `${viewport.width}px 长结果气泡左侧不得被裁切`);
    assert.ok(longTooltipGeometry.tip.right <= longTooltipGeometry.scroll.right + 1, `${viewport.width}px 长结果气泡右侧不得被裁切`);
    assert.ok(longTooltipGeometry.tip.top >= longTooltipGeometry.scroll.top - 1, `${viewport.width}px 长结果气泡顶部不得被裁切`);
    assert.ok(longTooltipGeometry.tip.bottom <= longTooltipGeometry.scroll.bottom + 1, `${viewport.width}px 长结果气泡底部不得被裁切`);
    assert.equal(longTooltipGeometry.horizontalOverflow, false, `${viewport.width}px 长结果气泡不得制造结果区横向滚动`);
    await page.mouse.move(0, 0);
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
  await layoutPage.goto(`${baseUrl}/index.html#password`, { waitUntil: 'domcontentloaded' });
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
      assert.equal(state.actionPosition, viewport.width <= 1279 ? 'static' : 'fixed', `${viewport.width}px 快捷操作定位策略`);
      assert.equal(state.resultOffsetLeft > state.configOffsetLeft, viewport.width > 1560, `${viewport.width}px ${position} 策略与结果面板响应式排布`);
    }
  }
  await layoutContext.close();

  const archiveContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await archiveContext.route(/google-analytics\.com|googletagmanager\.com/u, (route) => route.fulfill({ status: 204, body: '' }));
  await archiveContext.route('https://x.com/Betaer', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Betaer on X</title>' }));
  const archivePage = await archiveContext.newPage();
  await archivePage.goto(`${baseUrl}/index-v1.75.html`, { waitUntil: 'domcontentloaded' });
  const archiveXLink = archivePage.getByRole('link', { name: '在 X 关注 Betaer' });
  await archiveXLink.waitFor({ state: 'visible' });
  assert.equal(await archiveXLink.getAttribute('href'), 'https://x.com/Betaer');
  assert.equal(await archiveXLink.getAttribute('target'), '_blank');
  assert.equal(await archiveXLink.getAttribute('rel'), 'noopener noreferrer');
  const archiveDesktopSizes = await archivePage.locator('.site-floating-github, .site-floating-x, .site-floating-copy').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
  assert.deepEqual(archiveDesktopSizes, [120, 120, 120]);
  assert.equal(await archiveXLink.locator('.site-floating-button-label').isVisible(), true, 'V1.7.5 桌面端 X 文字必须可见');
  assert.equal(await archiveXLink.locator('.site-floating-button-label').textContent(), '@Betaer', 'V1.7.5 桌面端 X 入口应显示账号名');
  assert.equal(await archivePage.locator('.site-floating-actions').evaluate((node) => getComputedStyle(node).position), 'fixed');
  const [archiveXPopup] = await Promise.all([archiveContext.waitForEvent('page'), archiveXLink.click()]);
  await archiveXPopup.waitForLoadState('domcontentloaded');
  assert.equal(archiveXPopup.url(), 'https://x.com/Betaer');
  await archiveXPopup.close();
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await archivePage.setViewportSize(viewport);
    for (const position of ['top', 'middle', 'bottom']) {
      await archivePage.evaluate((target) => {
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        scrollTo(0, target === 'top' ? 0 : target === 'middle' ? maxScroll / 2 : maxScroll);
      }, position);
      await archivePage.waitForTimeout(80);
      const overlaps = await archivePage.evaluate(() => {
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
            && rect.top < innerHeight && rect.left < innerWidth
            && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const actions = [...document.querySelectorAll('.site-floating-actions button, .site-floating-actions a')].filter(visible);
        const targets = [...document.querySelectorAll('.page-main button, .page-main a, .page-main input, .page-main select, .seo-shell a, .seo-shell summary, .archive-release-banner a, .site-global-footer a')]
          .filter((node) => !node.closest('.site-floating-actions') && visible(node));
        return actions.flatMap((action) => {
          const actionRect = action.getBoundingClientRect();
          return targets.flatMap((target) => {
            const targetRect = target.getBoundingClientRect();
            const overlapWidth = Math.min(actionRect.right, targetRect.right) - Math.max(actionRect.left, targetRect.left);
            const overlapHeight = Math.min(actionRect.bottom, targetRect.bottom) - Math.max(actionRect.top, targetRect.top);
            return overlapWidth > 1 && overlapHeight > 1
              ? [`${action.getAttribute('aria-label')} -> ${target.getAttribute('aria-label') || target.textContent.trim().slice(0, 28)}`]
              : [];
          });
        });
      });
      assert.deepEqual(overlaps, [], `V1.7.5 ${viewport.width}px ${position} 快捷操作不得遮挡页面交互`);
    }
  }
  await archivePage.setViewportSize({ width: 390, height: 844 });
  await archivePage.waitForFunction(() => {
    const node = document.querySelector('.site-floating-x');
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width === 44 && rect.height === 44;
  });
  assert.deepEqual(await archiveXLink.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      labelDisplay: getComputedStyle(node.querySelector('.site-floating-button-label')).display,
      actionPosition: getComputedStyle(node.closest('.site-floating-actions')).position,
    };
  }), { width: 44, height: 44, labelDisplay: 'none', actionPosition: 'static' });
  await archiveContext.close();

  const noCryptoContext = await browser.newContext();
  await noCryptoContext.addInitScript(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} }); });
  const noCryptoPage = await noCryptoContext.newPage();
  await noCryptoPage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  await noCryptoPage.waitForFunction(() => document.documentElement.dataset.passwordGeneratorReady === 'true');
  assert.equal(await noCryptoPage.locator('#generate-button').isDisabled(), true);
  assert.match(await noCryptoPage.locator('#crypto-status-chip').textContent(), /已停止/u);
  await noCryptoContext.close();

  process.stdout.write('V2.1 browser verification passed: BIP39 readiness, three synchronized preset sliders, embedded History, nine profiles, privacy, GA isolation, and responsive layouts.\n');
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
