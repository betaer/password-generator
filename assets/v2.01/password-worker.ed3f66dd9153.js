'use strict';

importScripts(`./${"runtime.38793d36e4a8.js"}`);

self.onmessage = async ({ data }) => {
  const jobId = data?.jobId;
  let results = [];
  try {
    const runtime = self.PasswordGeneratorV201;
    if (!runtime || runtime.version !== '2.0.1') throw new Error('V2.0.1 Worker runtime mismatch');
    if (!Number.isSafeInteger(jobId) || jobId < 1) throw new RangeError('invalid generation job id');
    const quantity = data?.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new RangeError('invalid batch quantity');
    const compiled = await runtime.compileGenerator('password', data.config, { cryptoLike: self.crypto });
    try {
      results = await compiled.sampleBatch(quantity);
      self.postMessage({ ok: true, jobId, results });
      results = [];
    } finally {
      if (typeof compiled.dispose === 'function') await compiled.dispose();
    }
  } catch (error) {
    for (const result of results) {
      try { self.PasswordGeneratorV201?.results?.clearGenerationResult(result); } catch { /* Worker 即将结束。 */ }
    }
    self.postMessage({ ok: false, jobId, error: error instanceof Error ? error.message : String(error) });
  }
};
