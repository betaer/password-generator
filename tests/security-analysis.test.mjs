import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sourceUrl = new URL('../assets/js/security-analysis.js', import.meta.url);

async function loadRuntime() {
  const source = await readFile(sourceUrl, 'utf8');
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  return sandbox.PasswordSecurityRuntime;
}

test('提供在线、慢哈希和快速离线三种攻击模型', async () => {
  const runtime = await loadRuntime();
  assert.deepEqual(Array.from(Object.keys(runtime.ATTACK_MODELS)), ['online', 'slowHash', 'fastOffline']);
  assert.equal(runtime.ATTACK_MODELS.online.guessesPerSecond, 100 / 3600);
  assert.equal(runtime.ATTACK_MODELS.slowHash.guessesPerSecond, 1e4);
  assert.equal(runtime.ATTACK_MODELS.fastOffline.guessesPerSecond, 1e10);
});

test('有效猜测次数取理论平均次数与模式猜测次数中的较小值', async () => {
  const runtime = await loadRuntime();
  const theoreticalOnly = runtime.createAssessment({ theoreticalBits: 41 });
  assert.equal(theoreticalOnly.effectiveGuessBits, 40);
  const patterned = runtime.createAssessment({ theoreticalBits: 80, patternGuesses: 1024 });
  assert.equal(patterned.effectiveGuesses, 1024);
  assert.equal(patterned.effectiveGuessBits, 10);
});

test('L1～L8 使用固定有效猜测 bit 边界', async () => {
  const runtime = await loadRuntime();
  const cases = [
    [0, 'L1'], [19.99, 'L1'], [20, 'L2'], [32, 'L3'], [40, 'L4'],
    [52, 'L5'], [64, 'L6'], [80, 'L7'], [112, 'L8'], [512, 'L8'],
  ];
  for (const [bits, expected] of cases) {
    assert.equal(runtime.strengthFromGuessBits(bits).level, expected, `${bits} bits`);
  }
});

test('三种攻击时间使用同一有效猜测次数且速度比例正确', async () => {
  const runtime = await loadRuntime();
  const assessment = runtime.createAssessment({ theoreticalBits: 61 });
  assert.equal(assessment.effectiveGuesses, 2 ** 60);
  assert.equal(
    assessment.attackTimes.slowHash.seconds / assessment.attackTimes.fastOffline.seconds,
    1e6,
  );
  assert.ok(Math.abs(
    assessment.attackTimes.online.seconds / assessment.attackTimes.slowHash.seconds - 360000,
  ) < 1e-6);
});

test('超大空间使用对数表示且格式化结果不出现 Infinity 或 NaN', async () => {
  const runtime = await loadRuntime();
  const assessment = runtime.createAssessment({ theoreticalBits: 4096 });
  assert.equal(assessment.effectiveGuessBits, 4095);
  assert.doesNotMatch(runtime.formatGuessCount(assessment.effectiveGuessBits), /Infinity|NaN/);
  for (const result of Object.values(assessment.attackTimes)) {
    assert.doesNotMatch(result.label, /Infinity|NaN/);
  }
});
