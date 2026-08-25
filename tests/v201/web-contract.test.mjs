import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

async function read(relative) {
  return readFile(new URL(relative, root), 'utf8');
}

test('v2.01 独立页面使用统一概率契约和按类型安全语义', async () => {
  const html = await read('v2.01.html');
  assert.match(html, /V2\.0\.1/);
  assert.match(html, /One probability contract · Nine generators/);
  assert.match(html, /精确计算生成空间；基于明确假设估算攻击成本/);
  assert.match(html, /隔离页面访问统计/);
  assert.doesNotMatch(html, /匿名页面访问统计|Exact Crack Time|精确 Crack Time/);
  assert.doesNotMatch(html, /assets\/v2\/|EmbeddedWordPacksV1|unsafe-inline/);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-same-origin|postMessage/);
});

test('v2.01 只加载内容哈希资产并提供版本握手', async () => {
  const [html, manifestText] = await Promise.all([
    read('v2.01.html'),
    read('assets/v2.01/manifest.json'),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.version, '2.0.1');
  for (const key of ['runtime', 'app', 'css', 'analyticsFrame', 'passwordWorker', 'zxcvbnWorker', 'passphrase', 'pinRisk']) {
    assert.match(manifest.assets[key], /\.[a-f0-9]{12}\.(?:js|css|html)$/u);
    assert.match(html, new RegExp(manifest.assets[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(manifest.assets.bip39.english.includes('.english.'), true);
  assert.match(html, /data-runtime-version="2\.0\.1"/);
});

test('页面源代码包含竞态、预算、剪贴板与按类型结果卡保护', async () => {
  const source = await read('src/v201/web/app.v201.js');
  assert.match(source, /createGenerationCoordinator/);
  assert.match(source, /generateAtomicBatch/);
  assert.match(source, /assertBatchBudget/);
  assert.match(source, /assertClipboardBudget/);
  assert.match(source, /data-v201-clipboard-fallback/);
  assert.match(source, /presentationProfile/);
  assert.match(source, /Identifier, not a secret/);
  assert.match(source, /Observed Pattern Estimate/);
  assert.match(source, /Attack Scenario Estimate/);
  assert.doesNotMatch(source, /textarea\.style\.|EmbeddedWordPacksV1|PasswordGeneratorV2\b/);
});
