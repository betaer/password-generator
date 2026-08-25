import test from 'node:test';
import assert from 'node:assert/strict';

import { generateAtomicBatch } from '../../src/v201/batch-generator.mjs';
import { createGenerationCoordinator } from '../../src/v201/generation-job.mjs';

test('每批只编译一次模型并复用 sampleOne', async () => {
  const coordinator = createGenerationCoordinator();
  const job = coordinator.begin('token', { byteLength: 16 }, 3);
  let compileCount = 0;
  let sampleCount = 0;
  let disposeCount = 0;

  const results = await generateAtomicBatch({
    job,
    isCurrent: coordinator.isCurrent,
    compile() {
      compileCount += 1;
      return {
        async sampleOne() {
          sampleCount += 1;
          return { id: `r${sampleCount}` };
        },
        dispose() { disposeCount += 1; },
      };
    },
    clearResult() {},
  });

  assert.deepEqual(results.map(({ id }) => id), ['r1', 'r2', 'r3']);
  assert.equal(compileCount, 1);
  assert.equal(sampleCount, 3);
  assert.equal(disposeCount, 1);
});

test('sampleBatch 可一次生成整批且模型仍只编译一次', async () => {
  const coordinator = createGenerationCoordinator();
  const job = coordinator.begin('password', { length: 32 }, 4);
  let compileCount = 0;
  let batchCount = 0;

  const results = await generateAtomicBatch({
    job,
    isCurrent: coordinator.isCurrent,
    compile() {
      compileCount += 1;
      return {
        async sampleBatch(quantity) {
          batchCount += 1;
          return Array.from({ length: quantity }, (_, index) => ({ id: `p${index}` }));
        },
      };
    },
    clearResult() {},
  });

  assert.equal(results.length, 4);
  assert.equal(compileCount, 1);
  assert.equal(batchCount, 1);
});

test('部分成功后失败会主动清除全部未提交结果', async () => {
  const coordinator = createGenerationCoordinator();
  const job = coordinator.begin('passphrase', { wordCount: 6 }, 3);
  const cleared = [];
  let calls = 0;

  await assert.rejects(() => generateAtomicBatch({
    job,
    isCurrent: coordinator.isCurrent,
    compile() {
      return {
        async sampleOne() {
          calls += 1;
          if (calls === 3) throw new Error('forced failure');
          return { id: `partial-${calls}` };
        },
      };
    },
    clearResult(result) { cleared.push(result.id); },
  }), /forced failure/u);

  assert.deepEqual(cleared, ['partial-1', 'partial-2']);
});

test('模式切换造成 stale job 时丢弃并清理 Worker 回包', async () => {
  const coordinator = createGenerationCoordinator();
  const job = coordinator.begin('password', { length: 4096 }, 1);
  const cleared = [];

  await assert.rejects(() => generateAtomicBatch({
    job,
    isCurrent: coordinator.isCurrent,
    compile() {
      return {
        async sampleOne() {
          coordinator.begin('uuid', { version: 4 }, 1);
          return { id: 'stale-secret' };
        },
      };
    },
    clearResult(result) { cleared.push(result.id); },
  }), /stale|cancel/u);

  assert.deepEqual(cleared, ['stale-secret']);
});

test('无效 sampleBatch 形状也会清理已有结果并 fail closed', async () => {
  const coordinator = createGenerationCoordinator();
  const job = coordinator.begin('pin', { length: 4 }, 2);
  const cleared = [];

  await assert.rejects(() => generateAtomicBatch({
    job,
    isCurrent: coordinator.isCurrent,
    compile: () => ({ sampleBatch: async () => [{ id: 'only-one' }] }),
    clearResult(result) { cleared.push(result.id); },
  }), /exactly 2/u);
  assert.deepEqual(cleared, ['only-one']);
});

