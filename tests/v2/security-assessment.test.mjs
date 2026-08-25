import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACK_MODELS,
  RESOURCE_STATUSES,
  STRENGTH_LEVELS,
  assessObservedInput,
  createAssessment,
  createResourceState,
} from '../../src/v2/security-assessment.mjs';

const model = Object.freeze({
  minEntropyBits: 256,
  shannonEntropyBits: 256,
  averageGuessBits: 255,
  searchSpace: 2n ** 256n,
});

test('生成器指标在模式分析后保持不变', () => {
  const assessment = createAssessment({
    generationModel: model,
    patternAnalysis: { status: 'ready', guesses: 2 ** 40, patterns: ['dictionary'] },
  });

  assert.equal(assessment.generatorMinEntropyBits, 256);
  assert.equal(assessment.generatorShannonEntropyBits, 256);
  assert.equal(assessment.effectiveGuessBits, 40);
  assert.equal(assessment.metricKind, 'generator');
});

test('只有 ready 且无模式结果才显示未发现常见模式', () => {
  for (const status of ['idle', 'loading', 'degraded', 'error']) {
    const assessment = createAssessment({
      generationModel: model,
      patternAnalysis: { status, guesses: null },
    });
    assert.notEqual(assessment.patternMessage, '未发现常见模式');
  }

  const ready = createAssessment({
    generationModel: model,
    patternAnalysis: { status: 'ready', guesses: null, patterns: [] },
  });
  assert.equal(ready.patternMessage, '未发现常见模式');
});

test('所有攻击时间只读取同一个 Effective Guess Count', () => {
  const assessment = createAssessment({
    generationModel: { ...model, averageGuessBits: 64 },
    patternAnalysis: { status: 'ready', patternGuessBits: 50, patterns: ['date'] },
  });

  assert.equal(assessment.effectiveGuessBits, 50);
  assert.equal(assessment.attackTimes.fastOffline.log2Seconds, 50 - Math.log2(1e10));
  assert.equal(assessment.attackTimes.slowHash.log2Seconds, 50 - Math.log2(1e4));
  assert.equal(assessment.attackTimes.online.log2Seconds, 50 - Math.log2(100 / 3600));
});

test('BigInt 猜测次数不会先转成不精确 Number', () => {
  const assessment = createAssessment({
    generationModel: model,
    patternAnalysis: { status: 'ready', guesses: 2n ** 173n, patterns: ['structured'] },
  });

  assert.equal(assessment.patternGuessBits, 173);
  assert.equal(assessment.effectiveGuessBits, 173);
});

test('破解时间覆盖秒、分钟、小时、天、年和科学计数显示区间', () => {
  const labels = [0, 2, 8, 12, 20, 52].map((averageGuessBits) => createAssessment({
    generationModel: { ...model, averageGuessBits },
    patternAnalysis: { status: 'ready', guesses: null, patterns: [] },
  }).attackTimes.online.label);

  assert.ok(labels.some((label) => label.includes('秒')));
  assert.ok(labels.some((label) => label.includes('分钟')));
  assert.ok(labels.some((label) => label.includes('小时')));
  assert.ok(labels.some((label) => label.includes('天')));
  assert.ok(labels.some((label) => label.includes('年')));
  assert.ok(labels.some((label) => label.includes('次方年')));
});

test('模式结果只有更保守时才限制有效猜测次数', () => {
  const limited = createAssessment({
    generationModel: { ...model, averageGuessBits: 40 },
    patternAnalysis: { status: 'ready', patternGuessBits: 20, patterns: ['date'] },
  });
  const notLimited = createAssessment({
    generationModel: { ...model, averageGuessBits: 40 },
    patternAnalysis: { status: 'ready', patternGuessBits: 80, patterns: ['date'] },
  });

  assert.equal(limited.patternLimited, true);
  assert.equal(limited.strength.level, 'L2');
  assert.equal(notLimited.patternLimited, false);
  assert.equal(notLimited.effectiveGuessBits, 40);
});

test('无效生成模型和分析状态不会静默降级', () => {
  assert.throws(() => createAssessment({}), /缺少生成模型/);
  assert.throws(() => createAssessment({ generationModel: { minEntropyBits: -1 } }), /Generator Min-Entropy/);
  assert.throws(() => createAssessment({
    generationModel: model,
    patternAnalysis: { status: 'unknown' },
  }), /未知资源状态/);
});

test('等级常量不包含固定破解时间或固定年数', () => {
  assert.equal(STRENGTH_LEVELS.length, 8);
  for (const level of STRENGTH_LEVELS) {
    assert.equal('timeRange' in level, false);
    assert.doesNotMatch(JSON.stringify(level), /年|分钟|小时|10²/);
  }
});

test('资源状态只接受五个显式状态', () => {
  assert.deepEqual(RESOURCE_STATUSES, ['idle', 'loading', 'ready', 'degraded', 'error']);
  assert.deepEqual(createResourceState('loading', 'zxcvbn'), { status: 'loading', detail: 'zxcvbn' });
  assert.throws(() => createResourceState('fallback'), /资源状态/);
});

test('手动输入只返回 Observed Composition Estimate', () => {
  const assessment = assessObservedInput('aaaa-1111', { status: 'ready', guesses: 100 });

  assert.equal(assessment.metricKind, 'observed');
  assert.equal(assessment.metricLabel, 'Observed Composition Estimate');
  assert.equal('generatorMinEntropyBits' in assessment, false);
  assert.ok(assessment.observedEstimateBits >= 0);
});

test('空输入和完全重复输入的观察估算保持非负且不冒充生成器指标', () => {
  for (const value of ['', 'aaaaaaaa']) {
    const assessment = assessObservedInput(value, { status: 'ready', guesses: 1 });
    assert.ok(assessment.observedEstimateBits >= 0);
    assert.equal(assessment.metricKind, 'observed');
    assert.equal(assessment.patternMessage.includes('更保守'), true);
  }
});

test('攻击模型保持审核通过的三种速度', () => {
  assert.equal(ATTACK_MODELS.online.guessesPerSecond, 100 / 3600);
  assert.equal(ATTACK_MODELS.slowHash.guessesPerSecond, 1e4);
  assert.equal(ATTACK_MODELS.fastOffline.guessesPerSecond, 1e10);
});
