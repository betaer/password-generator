import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../index-2.0.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../../assets/v2/app.v2.js', import.meta.url), 'utf8');
const source = `${html}\n${app}`;

const MODE_HASHES = [
  '#password',
  '#passphrase',
  '#pin',
  '#token',
  '#api-secret',
  '#uuid',
  '#hex',
  '#random-bytes',
  '#mnemonic',
];

test('V2 exposes all nine independent generator hashes and three semantic groups', () => {
  for (const hash of MODE_HASHES) assert.match(source, new RegExp(hash.replace('-', '\\-')));
  assert.match(html, /人类凭据/);
  assert.match(html, /机器密钥/);
  assert.match(html, /标准标识符/);
});

test('V2 loads its same-origin runtime and local security resources', () => {
  assert.match(html, /\.\/assets\/v2\/runtime\.v2\.min\.js/);
  assert.match(html, /\.\/assets\/js\/embedded-word-packs\.js/);
  assert.doesNotMatch(html, /(?:unpkg|jsdelivr|cdnjs)\.com/);
});

test('generated results read immutable generationModel metadata rather than string appearance', () => {
  assert.match(source, /generationModel\.minEntropyBits/);
  assert.match(source, /generationModel\.searchSpace/);
  assert.doesNotMatch(source, /estimateGeneratedResult\s*\(/);
  assert.doesNotMatch(source, /estimateObservedCharacterEntropy\s*\(/);
});

test('resource states and retry affordances are explicit', () => {
  for (const state of ['idle', 'loading', 'ready', 'degraded', 'error']) {
    assert.match(source, new RegExp(`['\"]${state}['\"]`));
  }
  assert.match(source, /重试/);
  assert.match(source, /安全分析正在加载/);
  assert.match(source, /安全资源加载失败/);
});
