import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../../assets/v2/app.v2.js', import.meta.url), 'utf8');
const source = app;

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

test('V2 历史运行时仍保留九类独立生成器 hash', () => {
  for (const hash of MODE_HASHES) assert.match(source, new RegExp(hash.replace('-', '\\-')));
});

test('V2 历史运行时只引用同源安全资源', () => {
  assert.match(app, /\.\/assets\/js\/embedded-word-packs\.js/);
  assert.doesNotMatch(app, /(?:unpkg|jsdelivr|cdnjs)\.com/);
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
  assert.match(source, /V2 核心运行时加载失败 · 已停止生成/);
  assert.match(source, /\.\/assets\/v2\/pin-risk\.v2\.js/);
  assert.match(source, /\.\/assets\/js\/embedded-word-packs\.js/);
  assert.match(source, /\.\/assets\/v2\/zxcvbn-analyzer\.v2\.min\.js/);
});
