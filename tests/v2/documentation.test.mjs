import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [readme, english, notices, packageJson, llms, sitemap] = await Promise.all([
  readText('../../README.md'),
  readText('../../docs/readme-en.md'),
  readText('../../THIRD_PARTY_NOTICES.md'),
  readText('../../package.json'),
  readText('../../llms.txt'),
  readText('../../sitemap.xml'),
]);

test('V2 documentation names all nine generators and keeps V1 as a separate entry', () => {
  for (const name of ['Password', 'Passphrase', 'PIN', 'Token', 'API Secret', 'UUID', 'Hex', 'Random Bytes', 'Mnemonic']) {
    assert.match(readme, new RegExp(name.replace(' ', '\\s+'), 'i'));
    assert.match(english, new RegExp(name.replace(' ', '\\s+'), 'i'));
  }
  assert.match(readme, /index-2\.0\.html/);
  assert.match(readme, /V1\.7\.5/);
});

test('privacy documentation does not preserve the V1 auto-copy or session history claims', () => {
  assert.match(readme, /只生成，不自动写入剪贴板/);
  assert.match(readme, /生成记录默认关闭；启用后只保存在当前页面内存/);
  assert.doesNotMatch(readme, /结果会自动复制到剪贴板/);
  assert.doesNotMatch(readme, /历史记录只使用 `sessionStorage`/);
  assert.match(english, /History is off by default, memory-only/);
});

test('documentation records generator metrics, memory limits, and the analytics sandbox', () => {
  assert.match(readme, /Generator Min-Entropy/);
  assert.match(readme, /JavaScript String 不可变/);
  assert.match(readme, /没有 `allow-same-origin`/);
  assert.match(notices, /@scure\/bip39` 2\.3\.0/);
  assert.match(notices, /G-DWZ72TFWQF/);
  assert.match(notices, /不建立 `postMessage` 桥/);
});

test('package metadata publishes the current version and keeps runnable V2/V2.0.1 browser verification commands', () => {
  const metadata = JSON.parse(packageJson);
  assert.equal(metadata.version, '2.0.1');
  assert.equal(metadata.scripts['test:e2e:v2'], 'node scripts/verify-v2-browser.mjs');
  assert.equal(metadata.scripts['test:e2e:v201'], 'node scripts/verify-v201-browser.mjs');
});

test('discovery metadata points to V2 without carrying the V1 session-history claim', () => {
  assert.match(llms, /index-2\.0\.html/);
  assert.match(llms, /不使用 sessionStorage/);
  assert.doesNotMatch(llms, /历史记录仅使用当前标签页的 sessionStorage/);
  assert.match(sitemap, /index-2\.0\.html/);
  assert.match(sitemap, /2026-08-25/);
});
