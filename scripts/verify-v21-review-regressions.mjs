import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';

export async function verifyReviewRegressions(browser, baseUrl) {
  const context = await browser.newContext();
  await context.route('**/*google*/**', route => route.abort());
  await context.addInitScript(() => {
    globalThis.__reviewCopies = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => globalThis.__reviewCopies.push(text) } });
  });
  const page = await context.newPage();
  const mode = name => page.locator(`.mode-link[data-mode="${name}"]`).click();
  const generate = async () => {
    await page.locator('#generate-button').click();
    await expect(page.locator('#generate-button')).toHaveText('生成');
    await expect(page.locator('.compact-result-row').first()).toBeVisible();
  };
  try {
    await page.goto(`${baseUrl}/index.html#passphrase`);
    await expect(page.locator('#generate-button')).toBeEnabled();
    await page.locator('[name="capitalization"]').selectOption('random-uppercase');
    await page.locator('[name="separator"]').selectOption('random-digit');
    await page.locator('[name="wordCount"]').fill('3');
    await page.evaluate(() => {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      let first = true;
      crypto.subtle.digest = (...args) => {
        if (!first) return original(...args);
        first = false;
        return new Promise((resolve, reject) => {
          globalThis.__releaseReviewDigest = () => original(...args).then(resolve, reject);
        });
      };
    });
    await page.locator('#generate-button').click();
    assert.equal(await page.locator('#generate-button').isDisabled(), true, '读取异步配置时立即进入忙碌状态');
    await mode('pin'); await mode('passphrase');
    await page.locator('[name="wordCount"]').fill('6');
    await generate();
    await page.evaluate(async () => {
      await globalThis.__releaseReviewDigest();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(await page.locator('.compact-result-value').evaluate(node => node.textContent.split(/[0-9]/u).length), 6, '旧三词请求不得覆盖新六词请求');
    await expect(page.locator('.compact-result-meta')).toHaveText('6 个词 · 随机分隔符 · 随机一个词全大写');
    await expect(page.locator('#generate-button')).toBeEnabled();

    await mode('password');
    await page.getByRole('button', { name: 'L1，瞬间破解', exact: true }).click();
    await generate();
    const initialId = await page.locator('.compact-result-row').getAttribute('data-result-id');
    await page.getByRole('spinbutton', { name: '精确密码长度', exact: true }).fill('1');
    await page.locator('#regenerate-all').click();
    assert.equal(await page.locator('.compact-result-row').getAttribute('data-result-id'), initialId, '无效长度不应替换当前结果');
    assert.equal(await page.locator('[name="length"]').evaluate(node => node.validity.rangeUnderflow), true);

    await mode('uuid');
    await page.locator('[name="version"]').selectOption('7');
    await generate();
    await expect(page.locator('.compact-result-meta')).toContainText('UUID 7');
    await expect(page.locator('.compact-result-meta')).toContainText(/\d{4}-\d\d-\d\dT/u);
    assert.equal((await page.locator('#result-container').textContent()).includes('undefined'), false);

    await mode('pin');
    await page.locator('[name="length"]').selectOption('4');
    await page.locator('[name="quantity"]').fill('100');
    for (const name of ['limitSequential', 'blockWeak', 'uniqueWithinBatch']) await page.locator(`[name="${name}"]`).uncheck();
    await generate();
    await expect(page.locator('#result-container')).toContainText('39.14%');

    await mode('randomBytes');
    await page.locator('[name="quantity"]').fill('2');
    await page.locator('[name="byteLength"]').fill('65536');
    await expect(page.locator('[name="quantity"]')).toHaveValue('1');
    assert.equal(await page.locator('[name="quantity"]').getAttribute('max'), '1');
    await generate();
    await expect(page.locator('.compact-result-row')).toHaveCount(1);
    await page.locator('.result-file-details summary').click();
    const hash = await page.locator('[data-file-sha256]').textContent();
    assert.match(hash, /^[a-f0-9]{64}$/u);
    await page.getByRole('button', { name: '复制第 1 条文件 SHA-256', exact: true }).click();
    assert.equal(await page.evaluate(() => globalThis.__reviewCopies.at(-1)), hash);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载', exact: true }).click();
    const download = await downloadEvent;
    const fileHash = createHash('sha256');
    for await (const chunk of await download.createReadStream()) fileHash.update(chunk);
    assert.equal(fileHash.digest('hex'), hash, '完整摘要必须匹配实际下载文件');
    await page.locator('[name="byteLength"]').fill('64');
    assert.equal(await page.locator('[name="quantity"]').getAttribute('max'), '10');

    // 工作线程逐条返回错误不会卡死整批，也不会在 DOM 输出错误内的秘密。
    await mode('password');
    await page.getByRole('button', { name: 'L1，瞬间破解', exact: true }).click();
    await page.getByRole('spinbutton', { name: '精确生成数量', exact: true }).fill('3');
    await page.evaluate(() => {
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (data, ...rest) {
        if (String(data?.requestId).startsWith('analysis:')) {
          queueMicrotask(() => this.onmessage({ data: { requestId: data.requestId, ok: false, error: 'DO_NOT_RENDER_TEST_SECRET' } }));
        } else return original.call(this, data, ...rest);
      };
    });
    await generate();
    await expect(page.locator('[data-batch-pattern-text]')).toContainText('失败或降级 3 条');
    assert.equal((await page.locator('body').textContent()).includes('DO_NOT_RENDER_TEST_SECRET'), false);
    // 暂停时钟并丢弃回包，验证超时不再无限显示 loading。
    await page.clock.install();
    await page.evaluate(() => {
      const previous = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (data, ...rest) {
        if (String(data?.requestId).startsWith('analysis:')) return;
        return previous.call(this, data, ...rest);
      };
    });
    await generate();
    await page.clock.runFor(15001);
    await expect(page.locator('[data-batch-pattern-text]')).toContainText('失败或降级 3 条');
    await expect(page.locator('.resource-item').filter({ hasText: '观察模式分析工作线程' })).toContainText('降级');
    process.stdout.write('Review regressions: request race, validation, metadata, PIN collision, file hash, byte budget and analyzer failure PASS\n');
  } finally { await context.close(); }
}
