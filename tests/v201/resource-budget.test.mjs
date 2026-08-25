import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ANALYZER_CHARACTERS,
  MAX_BATCH_RAW_BYTES,
  MAX_CLIPBOARD_CHARACTERS,
  MAX_HISTORY_RAW_BYTES,
  MAX_RENDER_CHARACTERS,
  assertBatchBudget,
  createHistoryBudget,
} from '../../src/v201/resource-budget.mjs';

test('V2.0.1 使用统一且公开的资源预算', () => {
  assert.equal(MAX_BATCH_RAW_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_HISTORY_RAW_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_CLIPBOARD_CHARACTERS, 4 * 1024 * 1024);
  assert.equal(MAX_RENDER_CHARACTERS, 4096);
  assert.equal(MAX_ANALYZER_CHARACTERS, 512);
});

test('Random Bytes 达到 64 KiB 时强制 quantity=1', () => {
  assert.doesNotThrow(() => assertBatchBudget({ mode: 'randomBytes', byteLength: 65_535, quantity: 2 }));
  assert.doesNotThrow(() => assertBatchBudget({ mode: 'randomBytes', byteLength: 65_536, quantity: 1 }));
  assert.throws(
    () => assertBatchBudget({ mode: 'randomBytes', byteLength: 65_536, quantity: 2 }),
    /quantity.*1|数量.*1/u,
  );
  assert.throws(
    () => assertBatchBudget({ mode: 'randomBytes', byteLength: 1024 * 1024, quantity: 10 }),
    RangeError,
  );
});

test('总原始字节超过 8 MiB 时 fail closed', () => {
  assert.doesNotThrow(() => assertBatchBudget({ mode: 'token', byteLength: 4096, quantity: 100 }));
  assert.throws(
    () => assertBatchBudget({ mode: 'token', byteLength: 100_000, quantity: 100 }),
    /8 MiB/u,
  );
});

test('History 同时按条数和原始字节预算淘汰并清理', () => {
  const cleared = [];
  const history = createHistoryBudget({
    maxEntries: 100,
    maxBytes: 8,
    estimateBytes: (entry) => entry.bytes,
    clearEntry: (entry) => cleared.push(entry.id),
  });

  history.add([{ id: 'a', bytes: 4 }, { id: 'b', bytes: 4 }]);
  history.add([{ id: 'c', bytes: 6 }]);

  assert.deepEqual(history.entries.map(({ id }) => id), ['c']);
  assert.deepEqual(cleared, ['b', 'a']);
  assert.equal(history.totalBytes, 6);
});

test('大结果可以明确拒绝进入 History', () => {
  const history = createHistoryBudget({
    maxEntries: 100,
    maxBytes: 8,
    estimateBytes: (entry) => entry.bytes,
    clearEntry() {},
  });
  const accepted = history.add([{ id: 'large', bytes: 9 }]);
  assert.equal(accepted.length, 0);
  assert.equal(history.entries.length, 0);
});

test('History 可按 id 删除并只清理实际移除项', () => {
  const cleared = [];
  const history = createHistoryBudget({
    maxEntries: 10,
    maxBytes: 100,
    estimateBytes: (entry) => entry.bytes,
    clearEntry: (entry) => cleared.push(entry.id),
  });
  history.add([{ id: 'a', bytes: 2 }, { id: 'b', bytes: 3 }]);
  assert.equal(history.removeById('a'), true);
  assert.equal(history.removeById('missing'), false);
  assert.deepEqual(history.entries.map(({ id }) => id), ['b']);
  assert.equal(history.totalBytes, 3);
  assert.deepEqual(cleared, ['a']);
});
