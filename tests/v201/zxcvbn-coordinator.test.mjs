import test from 'node:test';
import assert from 'node:assert/strict';

import { createPatternAnalysisCoordinator } from '../../src/v201/zxcvbn-coordinator.mjs';

test('zxcvbn coordinator 单并发并使用 sequence 契约', async () => {
  let active = 0;
  let maximumActive = 0;
  const coordinator = createPatternAnalysisCoordinator({
    analyze: async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { patternGuesses: 32, sequence: [{ pattern: value.includes('1') ? 'date' : 'dictionary' }] };
    },
  });

  const updates = [];
  await coordinator.analyze([
    { id: 'a', type: 'password', value: 'password1' },
    { id: 'b', type: 'passphrase', value: 'correct-horse' },
  ], { epoch: 1, isLive: () => true, onUpdate: (id, result) => updates.push([id, result]) });

  assert.equal(maximumActive, 1);
  assert.deepEqual(updates.map(([, result]) => result.sequences), [['date'], ['dictionary']]);
});

test('分析输入严格截断到 512 字符且结果不包含明文 token', async () => {
  let received = '';
  const coordinator = createPatternAnalysisCoordinator({
    analyze: async (value) => {
      received = value;
      return { patternGuesses: 2, sequence: [{ pattern: 'repeat', token: value }] };
    },
  });
  const updates = [];
  await coordinator.analyze([{ id: 'long', type: 'password', value: 'x'.repeat(600) }], {
    epoch: 1,
    isLive: () => true,
    onUpdate: (_id, result) => updates.push(result),
  });

  assert.equal(received.length, 512);
  assert.equal(JSON.stringify(updates).includes('x'.repeat(20)), false);
});

test('stale epoch 或已删除结果的回调被丢弃', async () => {
  let release;
  let live = true;
  const coordinator = createPatternAnalysisCoordinator({
    analyze: () => new Promise((resolve) => { release = resolve; }),
  });
  const updates = [];
  const pending = coordinator.analyze([{ id: 'stale', type: 'password', value: 'secret' }], {
    epoch: 1,
    isLive: () => live,
    onUpdate: (...args) => updates.push(args),
  });
  await Promise.resolve();
  live = false;
  release({ patternGuesses: 2, sequence: [{ pattern: 'dictionary' }] });
  await pending;
  assert.deepEqual(updates, []);
});

test('分析器 late-ready 后重分析仍存活的当前结果与 History', async () => {
  const coordinator = createPatternAnalysisCoordinator();
  const current = [{ id: 'current', type: 'password', value: 'password' }];
  const history = [{ id: 'history', type: 'passphrase', value: 'alpha-beta' }];
  const updates = [];

  assert.equal(await coordinator.reanalyzeLive({ current, history, epoch: 3, isLive: () => true, onUpdate() {} }), false);
  coordinator.setAnalyzer(async () => ({ patternGuesses: 4, sequence: [{ pattern: 'dictionary' }] }));
  assert.equal(await coordinator.reanalyzeLive({
    current,
    history,
    epoch: 3,
    isLive: () => true,
    onUpdate: (id) => updates.push(id),
  }), true);
  assert.deepEqual(updates, ['current', 'history']);
});
