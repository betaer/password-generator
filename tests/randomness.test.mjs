import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appStart = html.indexOf('const React =');
assert.ok(appStart > -1, '缺少应用业务脚本');
const app = html.slice(appStart);

function buildRandomApi(samples = []) {
  const source = app.match(/function secureUint32[\s\S]*?(?=\nfunction uniqueChars)/)?.[0];
  assert.ok(source, '缺少 Web Crypto 随机函数');
  const queue = [...samples];
  const crypto = {
    getRandomValues(array) {
      assert.ok(queue.length > 0, '测试随机样本不足');
      array[0] = queue.shift();
      return array;
    },
  };
  const api = Function('crypto', `${source}; return { secureInt, secureChoice, secureRandomIndex, secureShuffle };`)(crypto);
  return { ...api, queue };
}

test('secureInt 遇到拒绝区间值时重新取样', () => {
  const { secureInt, queue } = buildRandomApi([0xffffffff, 7]);
  assert.equal(secureInt(10), 7);
  assert.equal(queue.length, 0);
});

test('secureRandomIndex 同样使用拒绝采样', () => {
  const { secureRandomIndex, queue } = buildRandomApi([0xffffffff, 9]);
  assert.equal(secureRandomIndex(10), 9);
  assert.equal(queue.length, 0);
});

test('secureChoice 与 Fisher-Yates 洗牌沿用 secureInt', () => {
  const { secureChoice, secureShuffle } = buildRandomApi([1, 0, 0]);
  assert.equal(secureChoice(['a', 'b', 'c']), 'b');
  assert.deepEqual(secureShuffle(['a', 'b', 'c']), ['b', 'c', 'a']);
});

test('业务生成逻辑不使用 Math.random', () => {
  assert.doesNotMatch(app, /Math\.random\s*\(/);
});

test('所有安全随机入口都使用 crypto.getRandomValues', () => {
  assert.match(app, /function secureUint32[\s\S]*?crypto\.getRandomValues\(array\)/);
  assert.match(app, /function secureRandomIndex[\s\S]*?crypto\.getRandomValues\(buffer\)/);
  assert.match(app, /function secureInt[\s\S]*?while \(value >= limit\)/);
  assert.match(app, /function secureShuffle[\s\S]*?secureInt\(index \+ 1\)/);
});
