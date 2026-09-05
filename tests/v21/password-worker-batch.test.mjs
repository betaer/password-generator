import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordWorkerBatch } from '../../src/v21/password-worker-batch.mjs';

function fixture(options = {}) {
  const timers = new Map(); let nextTimer = 0; let terminated = 0; let settled = 0;
  const worker = { postMessage() {}, terminate() { terminated++; } };
  const batch = createPasswordWorkerBatch({ worker, jobId: 7, config: { length: 8 },
    deserialize: value => value, clearResult() {}, onSettled() { settled++; },
    setTimer: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimer: id => timers.delete(id),
    ...options,
  });
  return { worker, batch, timers, get terminated() { return terminated; }, get settled() { return settled; } };
}

test('取消工作线程清除定时器，旧超时回调不能再次结算', async () => {
  const f = fixture(); const pending = f.batch.sampleBatch(2);
  const reject = assert.rejects(pending, { name: 'GenerationCancelledError' });
  const timeout = [...f.timers.values()][0];
  f.batch.cancel('切换类型'); await reject;
  assert.equal(f.timers.size, 0);
  timeout(); f.batch.dispose();
  assert.equal(f.terminated, 1); assert.equal(f.settled, 1);
  assert.equal(f.worker.onmessage, null);
});

test('成功回包、错误、超时和发送异常都只清理一次', async () => {
  for (const failure of ['success', 'error', 'messageerror', 'timeout', 'post']) {
    const f = fixture();
    if (failure === 'post') f.worker.postMessage = () => { throw new Error('post failed'); };
    const pending = f.batch.sampleBatch(1);
    const assertion = failure === 'success' ? assert.doesNotReject(pending) : assert.rejects(pending);
    if (failure === 'success') f.worker.onmessage({ data: { ok: true, jobId: 7, results: [{ value: 'test' }] } });
    if (failure === 'error') f.worker.onerror();
    if (failure === 'messageerror') f.worker.onmessageerror();
    if (failure === 'timeout') [...f.timers.values()][0]();
    await assertion; f.batch.dispose();
    assert.equal(f.timers.size, 0); assert.equal(f.terminated, 1); assert.equal(f.settled, 1);
  }
});

test('回包校验失败会清理部分反序列化结果，禁止重复采样', async () => {
  const cleared = [];
  const f = fixture({ deserialize(value) { if (value.bad) throw new Error('invalid'); return value; }, clearResult: value => cleared.push(value) });
  const pending = f.batch.sampleBatch(2); const assertion = assert.rejects(pending, /invalid/u);
  const good = { value: 'test' };
  f.worker.onmessage({ data: { ok: true, jobId: 7, results: [good, { bad: true }] } });
  await assertion;
  assert.deepEqual(cleared, [good]);
  await assert.rejects(f.batch.sampleBatch(1));
});

test('错任务回包、错误回包、缺少数组都拒绝，提前 dispose 也可安全取消', async () => {
  for (const data of [{ ok: true, jobId: 6, results: [] }, { ok: false, jobId: 7 }, { ok: true, jobId: 7 }]) {
    const f = fixture(); const pending = f.batch.sampleBatch(1); const assertion = assert.rejects(pending);
    f.worker.onmessage({ data }); await assertion;
    assert.equal(f.timers.size, 0);
  }
  const f = fixture(); f.batch.dispose();
  await assert.rejects(f.batch.sampleBatch(1), { name: 'GenerationCancelledError' });
  assert.equal(f.terminated, 1);
});
