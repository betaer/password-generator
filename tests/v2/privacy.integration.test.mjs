import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../../assets/v2/app.v2.js', import.meta.url), 'utf8');
const pinModel = await readFile(new URL('../../src/v2/pin-model.mjs', import.meta.url), 'utf8');
const source = app;

test('Generate and Copy are separate actions', () => {
  assert.match(source, /function generateResults\s*\(/);
  assert.match(source, /function copyCurrentResult\s*\(/);
  assert.doesNotMatch(source, /generateAndCopy/);
});

test('missing Web Crypto becomes an explicit blocking resource error', () => {
  assert.match(app, /Web Crypto 不可用 · 已停止生成/);
  assert.match(app, /!globalThis\.crypto\?\.getRandomValues/);
});

test('V2 has no persistent secret history storage', () => {
  assert.doesNotMatch(source, /HISTORY_SESSION_KEY/);
  assert.doesNotMatch(source, /sessionStorage\.(?:setItem|getItem)/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*(?:result|history|secret|password|mnemonic)/i);
  assert.match(source, /historyEnabled:\s*false/);
  assert.match(source, /slice\(0,\s*100\)/);
});

test('module-lifetime PIN caches never retain generated prefixes or full PIN values', () => {
  const blockedCounter = pinModel.match(
    /function createBlockedCompletionCounter[\s\S]*?function countBlockedIntersection/,
  )?.[0] ?? '';
  assert.match(blockedCounter, /countPeriodicBlocked\(normalized, value\) \+ explicitCount\(value\)/);
  assert.doesNotMatch(blockedCounter, /memo/);
  assert.doesNotMatch(blockedCounter, /\.set\(\s*(?:value|prefix)\b/);
});

test('clipboard fallback always clears and removes its temporary textarea', () => {
  assert.match(app, /finally\s*\{[\s\S]*?textarea\.value\s*=\s*['\"][\s\S]*?textarea\.remove\(\)/);
  assert.match(app, /if \(!copied\) throw new Error/);
  assert.match(app, /复制失败；浏览器未授予剪贴板权限/);
});

test('masked result is a separate placeholder and disclosure is explicit', () => {
  assert.match(app, /function maskedValue\s*\(/);
  assert.match(app, /secretState/);
  assert.match(app, /显示明文/);
  assert.match(app, /隐藏明文/);
  assert.doesNotMatch(source, /title:\s*(?:item|result)\.value/);
});

test('large random byte output is truncated unless the user explicitly copies or downloads it', () => {
  assert.match(app, /MAX_DOM_SECRET_CHARACTERS/);
  assert.match(app, /下载原始字节/);
  assert.match(app, /createBinaryDownload/);
});

test('worker results omit their null byte placeholder and reject failed rehydration', () => {
  assert.match(app, /const \{ bytes, id: _workerId, \.\.\.serializedResult \} = data\.result/);
  assert.match(app, /bytes instanceof Uint8Array \? \{ bytes \} : \{\}/);
  assert.match(app, /catch \(error\) \{\s*reject\(error\);\s*\}/);
});
