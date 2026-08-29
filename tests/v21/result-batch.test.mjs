import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregatePatternStates,
  createBatchPresentationSnapshot,
  createBatchRequestSnapshot,
  hasDuplicateResultValue,
  replaceResultById,
  shouldRejectUniqueReplacement,
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

test('批次展示源只冻结公共非秘密模型且不保留值或原始字节', () => {
  const source = createBatchPresentationSnapshot({
    id: 'result-a',
    type: 'random-bytes',
    schemaVersion: '2.0.1',
    value: 'SECRET',
    preview: 'abcd…',
    sha256: 'secret-hash',
    bytes: new Uint8Array([1, 2, 3]),
    configSnapshot: { byteLength: 3, encoding: 'hex' },
    generationModel: { presentationProfile: 'random-bytes', generatorMinEntropyBits: 24 },
  }, 4);

  assert.deepEqual(source, {
    id: 'batch:result-a',
    type: 'random-bytes',
    schemaVersion: '2.0.1',
    configSnapshot: { byteLength: 3, encoding: 'hex' },
    generationModel: { presentationProfile: 'random-bytes', generatorMinEntropyBits: 24 },
    quantity: 4,
    randomByteLength: 3,
    checksumValid: null,
  });
  assert.equal('value' in source, false);
  assert.equal('bytes' in source, false);
  assert.equal('sha256' in source, false);
  assert.equal(Object.isFrozen(source.generationModel), true);
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

test('只有启用批内唯一的 PIN 才拒绝与其余行重复', () => {
  const results = [{ id: 'a', value: '1234' }, { id: 'b', value: '5678' }];
  const replacement = { value: '5678' };
  assert.equal(shouldRejectUniqueReplacement(results, 'a', replacement, { mode: 'pin', config: { uniqueWithinBatch: true } }), true);
  assert.equal(shouldRejectUniqueReplacement(results, 'a', replacement, { mode: 'pin', config: { uniqueWithinBatch: false } }), false);
  assert.equal(shouldRejectUniqueReplacement(results, 'a', replacement, { mode: 'password', config: {} }), false);
  assert.equal(shouldRejectUniqueReplacement(results, 'a', { value: '' }, { mode: 'randomBytes', config: {} }), false);
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
