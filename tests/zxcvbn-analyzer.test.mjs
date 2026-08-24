import test from 'node:test';
import assert from 'node:assert/strict';

const analyzerUrl = new URL('../assets/vendor/zxcvbn-analyzer.v2.min.js', import.meta.url);

async function loadAnalyzer() {
  return import(`${analyzerUrl.href}?test=${Date.now()}`);
}

test('识别常见密码、l33t、键盘路径、日期和重复模式', async () => {
  const analyzer = await loadAnalyzer();
  const random = analyzer.analyzePassword('vQ7!mZ2@xR9#');
  const weak = ['password123', 'p@ssw0rd', 'qwertyuiop', '20260825', 'abcabcabc'];
  for (const value of weak) {
    const result = analyzer.analyzePassword(value);
    assert.ok(result.guesses < random.guesses, `${value} 应弱于等长随机结果`);
  }
});

test('只有 bruteforce 段的机器随机密码不受 zxcvbn 猜测上限误降级', async () => {
  const analyzer = await loadAnalyzer();
  const random = analyzer.analyzePassword('Rl(%:m&(%0B&7Ld/}=kwI6M(4[fD+"}T');
  assert.deepEqual(random.sequence.map((item) => item.pattern), ['bruteforce']);
  assert.equal(random.patternGuesses, null);

  const predictable = analyzer.analyzePassword('correct-horse-battery-staple-2026');
  assert.ok(Number.isFinite(predictable.patternGuesses));
  assert.ok(predictable.sequence.some((item) => item.pattern !== 'bruteforce'));
});

test('分析结果不回传密码明文或匹配 token', async () => {
  const analyzer = await loadAnalyzer();
  const secret = 'DoNotReturn-vQ7!mZ2@';
  const result = analyzer.analyzePassword(secret);
  assert.equal(Object.hasOwn(result, 'password'), false);
  assert.equal(Object.hasOwn(result, 'token'), false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(result.sequence.every((item) => !Object.hasOwn(item, 'token')));
});

test('空值和非字符串输入安全降级', async () => {
  const analyzer = await loadAnalyzer();
  for (const input of ['', null, undefined, 123456]) {
    const result = analyzer.analyzePassword(input);
    assert.ok(Number.isFinite(result.guesses));
    assert.ok(result.guesses >= 1);
    assert.ok(Number.isInteger(result.score));
  }
});
