import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregatePatternStates,
  createBatchRequestSnapshot,
  hasDuplicateResultValue,
  replaceResultById,
} from '../../src/v21/result-batch.mjs';

test('批次请求深拷贝并冻结非秘密配置', () => {
  const config = { length: 20, ratio: [10, 20], nested: { enabled: true } };
  const snapshot = createBatchRequestSnapshot('password', config);

  config.ratio[0] = 99;
  config.nested.enabled = false;

  assert.deepEqual(snapshot, {
    mode: 'password',
    config: { length: 20, ratio: [10, 20], nested: { enabled: true } },
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.config), true);
  assert.equal(Object.isFrozen(snapshot.config.ratio), true);
  assert.equal(Object.isFrozen(snapshot.config.nested), true);
});

test('批次请求拒绝未知模式和非 plain config', () => {
  assert.throws(() => createBatchRequestSnapshot('', {}), /mode/u);
  assert.throws(() => createBatchRequestSnapshot('password', []), /config/u);
  assert.throws(() => createBatchRequestSnapshot('password', null), /config/u);
});

test('单条替换保持顺序且不修改原数组', () => {
  const first = Object.freeze({ id: 'a', value: 'one' });
  const second = Object.freeze({ id: 'b', value: 'two' });
  const replacement = Object.freeze({ id: 'c', value: 'three' });
  const current = [first, second];

  const next = replaceResultById(current, 'b', replacement);

  assert.deepEqual(next, [first, replacement]);
  assert.deepEqual(current, [first, second]);
  assert.notEqual(next, current);
});

test('单条替换拒绝不存在、重复或畸形结果', () => {
  const results = [{ id: 'a', value: 'one' }, { id: 'b', value: 'two' }];
  assert.throws(() => replaceResultById(results, 'missing', { id: 'c', value: 'three' }), /不存在/u);
  assert.throws(() => replaceResultById(results, 'a', { id: 'b', value: 'three' }), /重复/u);
  assert.throws(() => replaceResultById(results, 'a', null), /replacement/u);
});

test('唯一结果检测排除被替换行并拒绝缺失值', () => {
  const results = [{ id: 'a', value: '1234' }, { id: 'b', value: '5678' }];
  assert.equal(hasDuplicateResultValue(results, 'a', { value: '5678' }), true);
  assert.equal(hasDuplicateResultValue(results, 'a', { value: '1234' }), false);
  assert.equal(hasDuplicateResultValue(results, 'a', { value: '9012' }), false);
  assert.throws(() => hasDuplicateResultValue(results, 'a', {}), /value/u);
});

test('模式聚合区分分析中、已完成、风险和失败行', () => {
  const results = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const patterns = new Map([
    ['a', { status: 'ready', sequences: [] }],
    ['b', { status: 'ready', sequences: ['dictionary'] }],
    ['c', { status: 'loading', sequences: [] }],
    ['d', { status: 'idle', sequences: [] }],
    ['e', { status: 'error', sequences: [] }],
  ]);

  assert.deepEqual(aggregatePatternStates(results, patterns), {
    total: 5,
    completed: 2,
    risky: 1,
    loading: 2,
    failed: 1,
  });
});

test('没有模式分析的机器密钥不会被标记为失败', () => {
  const results = [{ id: 'a', type: 'token' }, { id: 'b', type: 'uuid' }];
  assert.deepEqual(aggregatePatternStates(results, new Map(), { analyzableTypes: [] }), {
    total: 0,
    completed: 0,
    risky: 0,
    loading: 0,
    failed: 0,
  });
});
