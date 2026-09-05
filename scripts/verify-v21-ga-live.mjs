import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { assertGaRequestContract } from './ga-request-contract.mjs';

/** Loads the unmodified Google script; only collect responses are intercepted. */
export async function verifyLiveAnalytics(browser, baseUrl) {
  const context = await browser.newContext();
  const requests = []; const captures = []; const googleScripts = []; const scriptCaptures = [];
  const diagnostics = [];
  context.on('requestfailed', request => diagnostics.push(`${new URL(request.url()).hostname}: ${request.failure()?.errorText}`));
  const sentinel = 'V21_GA_SECRET_SENTINEL_8c36e742d19a';
  const querySentinel = 'V21_PRIVATE_QUERY_96c3721a';
  await context.route('**/g/collect**', async route => {
    const request = route.request();
    const capture = request.allHeaders().then(headers => { requests.push({ url: request.url(), body: request.postData() || '', headers }); });
    captures.push(capture); await capture;
    await route.fulfill({ status: 204, body: '' });
  });
  context.on('response', response => {
    if (response.url().startsWith('https://www.googletagmanager.com/gtag/js?')) {
      scriptCaptures.push(response.body().then(body => {
        assert.equal(response.ok(), true);
        assert.ok(body.length > 10000, '必须执行完整 Google 脚本，不能使用模拟替身');
        googleScripts.push(createHash('sha256').update(body).digest('hex'));
      }).catch(() => diagnostics.push('无法读取完整 Google 脚本响应')));
    }
  });
  await context.addInitScript(() => {
    globalThis.__gaReviewMessageCount = 0;
    addEventListener('message', () => { globalThis.__gaReviewMessageCount++; });
  });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  page.on('pageerror', error => diagnostics.push(error.message));
  try {
    await page.goto(`${baseUrl}/index.html?private=${querySentinel}#api-secret`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#generate-button')).toBeEnabled();
    await page.locator('[name="prefix"]').fill(`${sentinel}_`);
    await page.locator('#generate-button').click();
    await expect(page.locator('.compact-result-value')).toContainText(sentinel);
    const generated = await page.locator('.compact-result-value').textContent();
    // 在父页面已经持有秘密后重新加载隔离帧，避免只测试生成前的 page_view。
    await expect.poll(() => requests.length, { timeout: 30000, message: '真实 Google 脚本未产生可验收的 collect 请求（不允许跳过）' }).toBeGreaterThan(0);
    const before = requests.length;
    await page.locator('iframe[title="隔离页面访问统计"]').evaluate(frame => { frame.src = frame.src; });
    await expect.poll(() => requests.length, { timeout: 30000 }).toBeGreaterThan(before);
    await Promise.all(captures); await Promise.all(scriptCaptures);
    assert.ok(googleScripts.length > 0, '没有加载真实 Google 脚本');
    assert.ok(requests.map(record => assertGaRequestContract(record, [sentinel, querySentinel, generated])).some(result => result.pageView));
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await page.locator('iframe').evaluate(frame => frame.contentDocument), null);
    const frame = page.frames().find(frame => frame !== page.mainFrame());
    assert.equal(await frame.evaluate(() => { document.cookie = 'V21_COOKIE_TEST=1'; return document.cookie; }), '');
    assert.deepEqual(await context.cookies(), [], '测试上下文不得产生 Cookie');
    assert.equal(await page.evaluate(() => globalThis.__gaReviewMessageCount), 0, '父页面不得收到统计消息桥');
    assert.equal(await page.locator('script[src*="google"]').count(), 0);
    process.stdout.write(`Live GA contract PASS: ${requests.length} intercepted requests; Google script SHA-256 ${googleScripts[0]}\n`);
  } catch (error) {
    for (const frame of page.frames().filter(frame => frame !== page.mainFrame())) {
      diagnostics.push(JSON.stringify(await frame.evaluate(() => ({
        frameUrl: location.href, visibility: document.visibilityState,
        googleTags: Object.keys(globalThis.google_tag_manager || {}),
        layer: (globalThis.dataLayer || []).map(row => Array.from(row)),
      })).catch(() => ({ unavailable: true }))));
    }
    process.stderr.write(`Live GA diagnostics: loaded scripts=${googleScripts.length}; ${diagnostics.join(' | ')}\n`);
    throw error;
  } finally { await context.close(); }
}
