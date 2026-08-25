import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { createPinModel } from '../../src/v2/pin-model.mjs';
import {
  independentBatchCollisionProbability,
  sampleUniquePinBatch,
  unrankPin,
} from '../../src/v201/pin-batch.mjs';

test('PIN exact unrank 覆盖完整合法空间且保持字典序', () => {
  const model = createPinModel({
    length: 4,
    allowLeadingZero: true,
    allowRepeated: true,
    limitSequential: false,
    blockWeak: false,
  });

  assert.equal(model.searchSpace, 10_000n);
  assert.equal(unrankPin(model, 0n), '0000');
  assert.equal(unrankPin(model, 1n), '0001');
  assert.equal(unrankPin(model, 9_999n), '9999');
  assert.throws(() => unrankPin(model, 10_000n), RangeError);
});

test('默认约束下 unrank 只返回 completion-count 允许的 PIN', () => {
  const model = createPinModel({ length: 6, limitSequential: true });
  for (const rank of [0n, 1n, model.searchSpace / 2n, model.searchSpace - 1n]) {
    const pin = unrankPin(model, rank);
    assert.equal(pin.length, 6);
    assert.equal(model.completionCount(pin), 1n);
  }
});

test('四位 PIN 可一次均匀抽取 100 个批内唯一值', () => {
  const model = createPinModel({ length: 4, limitSequential: false });
  const batch = sampleUniquePinBatch(model, 100, webcrypto);

  assert.equal(batch.length, 100);
  assert.equal(new Set(batch).size, 100);
  assert.throws(() => sampleUniquePinBatch(model, 10_001, webcrypto), RangeError);
});

test('独立有放回抽样碰撞概率使用生日问题精确乘积', () => {
  const probability = independentBatchCollisionProbability(10_000n, 100);
  assert.ok(Math.abs(probability - 0.391434035042722) < 1e-12);
  assert.equal(independentBatchCollisionProbability(10_000n, 1), 0);
  assert.equal(independentBatchCollisionProbability(2n, 3), 1);
});
