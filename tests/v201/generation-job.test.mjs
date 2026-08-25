import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGenerationCoordinator,
  createGenerationJob,
} from '../../src/v201/generation-job.mjs';

test('Generation Job 深拷贝并冻结 mode/config/quantity', () => {
  const config = { length: 32, nested: { symbols: '!@#' } };
  const job = createGenerationJob({ id: 7, mode: 'password', config, quantity: 3 });
  config.nested.symbols = 'x';

  assert.deepEqual(job, {
    id: 7,
    mode: 'password',
    config: { length: 32, nested: { symbols: '!@#' } },
    quantity: 3,
  });
  assert.equal(Object.isFrozen(job), true);
  assert.equal(Object.isFrozen(job.config.nested), true);
});

test('Generation Coordinator 使旧 epoch 立即失效并支持显式取消', () => {
  const coordinator = createGenerationCoordinator();
  const first = coordinator.begin('password', { length: 32 }, 1);
  const second = coordinator.begin('uuid', { version: 4 }, 1);

  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.isCurrent(second), true);
  assert.equal(coordinator.cancel('mode-switch'), second);
  assert.equal(coordinator.isCurrent(second), false);
  assert.equal(coordinator.cancelReason, 'mode-switch');
});

test('Generation Job 拒绝未知模式、无效数量和可变二进制配置', () => {
  assert.throws(() => createGenerationJob({ id: 1, mode: 'x', config: {}, quantity: 1 }), RangeError);
  assert.throws(() => createGenerationJob({ id: 1, mode: 'pin', config: {}, quantity: 0 }), RangeError);
  assert.throws(() => createGenerationJob({ id: 1, mode: 'pin', config: Uint8Array.of(1), quantity: 1 }), TypeError);
});

