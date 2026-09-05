function cancelledError(reason) {
  return Object.assign(new Error(`生成任务已取消：${reason}`), { name: 'GenerationCancelledError' });
}

/** One worker, one batch, one cleanup path. No callback mutates another job. */
export function createPasswordWorkerBatch({
  worker, jobId, config, deserialize, clearResult, onSettled,
  timeoutMs = 180000, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let timer = null;
  let started = false;
  let finished = false;
  let rejectPending = null;
  const finish = () => {
    if (finished) return false;
    finished = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
    worker.terminate();
    onSettled();
    return true;
  };
  const cancel = (reason = '已释放') => {
    if (finish()) rejectPending?.(cancelledError(reason));
    rejectPending = null;
  };
  return Object.freeze({
    mode: 'password', model: Object.freeze({ jobId }), cancel, dispose: cancel,
    sampleBatch(quantity) {
      if (started || finished) return Promise.reject(cancelledError('任务已结束或已开始'));
      started = true;
      return new Promise((resolve, reject) => {
        rejectPending = reject;
        const fail = error => { if (finish()) reject(error); rejectPending = null; };
        timer = setTimer(() => fail(new Error('密码概率模型计算超时。')), timeoutMs);
        worker.onerror = () => fail(new Error('密码工作线程启动失败。'));
        worker.onmessageerror = () => fail(new Error('密码工作线程回包无法解析。'));
        worker.onmessage = ({ data }) => {
          if (finished) return;
          const results = [];
          try {
            if (!data?.ok || data.jobId !== jobId || !Array.isArray(data.results)) throw new Error('密码工作线程回包无效。');
            if (data.results.length !== quantity) throw new Error('密码工作线程结果数量不匹配。');
            for (const serialized of data.results) results.push(deserialize(serialized));
            finish(); rejectPending = null; resolve(results);
          } catch (error) {
            for (const result of results) clearResult(result);
            fail(error);
          }
        };
        try { worker.postMessage({ jobId, config, quantity }); } catch (error) { fail(error); }
      });
    },
  });
}
