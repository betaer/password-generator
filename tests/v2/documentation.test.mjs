import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [readme, english, notices, packageJson] = await Promise.all([
  readText('../../README.md'),
  readText('../../docs/readme-en.md'),
  readText('../../THIRD_PARTY_NOTICES.md'),
  readText('../../package.json'),
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
  assert.match(readme, /History \| 默认关闭；启用后只保存在当前页面内存/);
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

test('package metadata publishes the V2 version and a runnable browser verification command', () => {
  const metadata = JSON.parse(packageJson);
  assert.equal(metadata.version, '2.0.0');
  assert.equal(metadata.scripts['test:e2e:v2'], 'node scripts/verify-v2-browser.mjs');
});
