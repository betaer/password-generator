import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

async function captureCopies(context) {
  await context.addInitScript(() => {
    if (globalThis.__lifecycleInstalled) return;
    globalThis.__lifecycleInstalled = true;
    globalThis.__lifecycleCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { globalThis.__lifecycleCopies.push(text); },
    } });
    globalThis.__lifecycleEvents = [];
    addEventListener('pageshow', event => __lifecycleEvents.push({ type: 'show', persisted: event.persisted }));
    addEventListener('pagehide', event => __lifecycleEvents.push({ type: 'hide', persisted: event.persisted }));
  });
}

async function ready(page, url) {
  const target = new URL(url);
  if (page.url().split('#')[0] === target.href.split('#')[0]) {
    const mode = target.hash.slice(1) === 'random-bytes' ? 'randomBytes' : target.hash.slice(1);
    await page.locator(`.mode-link[data-mode="${mode}"]`).click();
  } else {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await expect(page.locator('#generate-button')).toBeEnabled();
}

async function generate(page) {
  await page.locator('#generate-button').click();
  await expect(page.locator('#generate-button')).toHaveText('生成');
  await expect(page.locator('.compact-result-row').first()).toBeVisible();
}

async function expectCleared(page) {
  await expect(page.locator('.compact-result-row')).toHaveCount(0);
  await expect(page.locator('.history-row')).toHaveCount(0);
  await expect(page.locator('#history-summary-count')).toHaveText('未启用');
  await expect(page.locator('#history-toggle')).not.toBeChecked();
  await expect(page.locator('#history-budget-status')).toHaveText('0 / 8,388,608 字节');
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
}

export async function verifyLifecycleRegressions(browser, baseUrl) {
  const context = await browser.newContext();
  // Lifecycle behavior must not depend on third-party network timing; GA has its own live gate.
  await context.route('**/*google*/**', route => route.abort());
  await captureCopies(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    // Re-enter the same frozen document twice, not a reload/new document fallback.
    for (const mode of ['random-bytes', 'password']) {
      await ready(page, `${baseUrl}/index.html#${mode}`);
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.locator('#history-toggle').check();
        await generate(page);
        await page.locator('#history-panel').evaluate(el => { el.open = true; });
        await page.locator('.history-preview').hover();
        await expect(page.locator('.history-tooltip')).toBeVisible();
        // Reset only the event log. Keep app state intact until real navigation.
        await page.evaluate(() => { globalThis.__lifecycleEvents = []; });
        await page.goto(`${baseUrl}/robots.txt`);
        // Some Chromium/Playwright versions omit lifecycle completion for BFCache.
        // A timeout is acceptable ONLY when the actual persisted events below prove restoration.
        await page.goBack({ waitUntil: 'commit', timeout: 1500 }).catch(error => {
          if (error.name !== 'TimeoutError') throw error;
        });
        await expect.poll(() => page.evaluate(() => globalThis.__lifecycleEvents || []), { timeout: 5000 })
          .toEqual([{ type: 'hide', persisted: true }, { type: 'show', persisted: true }]);
        await expectCleared(page);
        assert.equal(await page.evaluate(() => __lifecycleCopies.length), 0);
        await expect(page.locator('#generate-button')).toBeEnabled();
      }
    }

    // A pending digest cannot restore a result after page cleanup/cancellation.
    await ready(page, `${baseUrl}/index.html#random-bytes`);
    await page.locator('#history-toggle').check();
    await page.evaluate(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = (algorithm, bytes) => new Promise((resolve, reject) => {
        globalThis.__pendingLifecycleBytes = bytes;
        globalThis.__finishLifecycleDigest = () => digest(algorithm, bytes).then(resolve, reject);
      });
    });
    await page.locator('#generate-button').click();
    await page.waitForFunction(() => Boolean(globalThis.__finishLifecycleDigest));
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.evaluate(() => __finishLifecycleDigest());
    await expect.poll(() => page.evaluate(() => __pendingLifecycleBytes.every(byte => byte === 0))).toBe(true);
    await expectCleared(page);
    assert.deepEqual(errors, []);
    process.stdout.write('Lifecycle PASS: real BFCache restored twice per profile, no stale history/copies, pending bytes cleared\n');
  } finally { await context.close(); }
}

export async function verifyTooltipRegressions(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*google*/**', route => route.abort());
  await captureCopies(context);
  const page = await context.newPage();
  try {
    await ready(page, `${baseUrl}/index.html#token`);
    await page.locator('[name="byteLength"]').fill('1024');
    await page.locator('[name="encoding"]').selectOption('hex');
    await page.locator('#history-toggle').check();
    await generate(page);
    const value = page.locator('.compact-result-value');
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await value.hover();
      const tip = page.locator('.compact-result-row > .result-tooltip');
      await expect(tip).toBeVisible();
      assert.equal(await tip.evaluate(el => getComputedStyle(el).pointerEvents), 'auto', '长气泡必须可接收鼠标滚轮');
      assert.equal(await tip.evaluate(el => el.scrollHeight > el.clientHeight), true);
      await tip.hover();
      await expect.poll(() => tip.evaluate(el => el.matches(':hover'))).toBe(true);
      await page.mouse.wheel(0, 10000);
      await expect.poll(() => tip.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2),
        { message: `气泡滚轮应读到全文末尾：${width}px` }).toBe(true);
      // Hover must remain stable after crossing the trigger-to-popup gap.
      await expect(tip).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(tip).toHaveCount(0);
      await value.focus();
      await expect(tip).toBeVisible();
      await tip.focus();
      await page.keyboard.press('End');
      await expect.poll(() => tip.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(tip).toHaveCount(0);
      await value.blur();
      assert.equal(await value.getAttribute('title'), null);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#history-panel').evaluate(el => { el.open = true; });
    const historyValue = page.locator('.history-preview');
    await historyValue.hover();
    const historyTip = page.locator('.history-tooltip');
    await historyTip.hover(); await page.mouse.wheel(0, 10000);
    await expect.poll(() => historyTip.evaluate(el => el.scrollTop > 0)).toBe(true);
    await page.locator('#result-title').click();
    await expect(historyTip).toHaveCount(0);
    await historyValue.focus(); await page.keyboard.press('End');
    await expect.poll(() => historyTip.evaluate(el => el.scrollTop > 0)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(historyTip).toHaveCount(0);
    assert.equal(await page.evaluate(() => __lifecycleCopies.length), 0, '阅读全文不得写入剪贴板');
    await value.hover();
    await page.locator('[data-secret-toggle]').click();
    await expect(page.locator('.compact-result-row > .result-tooltip')).toHaveCount(0);
    await page.locator('[data-secret-toggle]').click();
    await value.hover();
    await expect(page.locator('.compact-result-row > .result-tooltip')).toBeVisible();
    await page.locator('#clear-results').click();
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
    await generate(page);
    const batch = page.locator('[data-batch-assessment]');
    await page.getByRole('button', { name: '批次级安全分析说明', exact: true }).focus();
    await page.locator('.batch-assessment-summary > [role="tooltip"]').click();
    assert.equal(await batch.evaluate(el => el.open), false, '点击气泡本身不得切换分析详情');
    await page.keyboard.press('Escape');
    await value.focus();
    await expect(page.locator('.compact-result-row > .result-tooltip')).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
    process.stdout.write('Tooltip PASS: desktop/narrow viewport wheel, keyboard, Escape/outside dismissal, hide/delete cleanup\n');
  } finally { await context.close(); }
}

export async function verifyTouchTooltips(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route('**/*google*/**', route => route.abort());
  await captureCopies(context);
  const page = await context.newPage();
  try {
    await ready(page, `${baseUrl}/index.html#token`);
    await page.locator('[name="byteLength"]').fill('1024');
    await page.locator('[name="encoding"]').selectOption('hex');
    await generate(page);
    const info = page.getByRole('button', { name: '批次级安全分析说明', exact: true });
    await info.tap();
    const batchTip = page.locator('.batch-assessment-summary > [role="tooltip"]');
    await expect(batchTip).toBeVisible();
    await batchTip.tap();
    assert.equal(await page.locator('[data-batch-assessment]').evaluate(el => el.open), false);
    assert.equal(await page.evaluate(() => __lifecycleCopies.length), 0);
    await page.locator('#result-title').tap();
    await expect(batchTip).toHaveCount(0);
    // Tapping the result is an explicit copy, while its full preview remains scrollable.
    await page.locator('.compact-result-value').tap();
    const tip = page.locator('.compact-result-row > .result-tooltip');
    await expect(tip).toBeVisible();
    await expect.poll(() => page.evaluate(() => __lifecycleCopies.length)).toBe(1);
    const bounds = await tip.boundingBox();
    const client = await context.newCDPSession(page);
    const x = bounds.x + bounds.width / 2;
    const startY = bounds.y + bounds.height - 25;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 6; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - step * 20 }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => tip.evaluate(el => el.scrollTop > 0)).toBe(true);
    await page.locator('[data-secret-toggle]').tap();
    await expect(page.locator('.compact-result-row > .result-tooltip')).toHaveCount(0);
    assert.equal(await page.evaluate(() => __lifecycleCopies.length), 1, '滑动和隐藏不能再次复制');
    process.stdout.write('Touch PASS: tap opens/closes help without toggling details, long preview swipes, explicit-copy-only\n');
  } finally { await context.close(); }
}
