function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
}

function staleError() {
  const error = new Error('generation job is stale or cancelled');
  error.name = 'GenerationCancelledError';
  return error;
}

export async function generateAtomicBatch({ job, compile, isCurrent, clearResult }) {
  if (!job || typeof job !== 'object') throw new TypeError('job is required');
  requireFunction(compile, 'compile');
  requireFunction(isCurrent, 'isCurrent');
  requireFunction(clearResult, 'clearResult');

  if (!isCurrent(job)) throw staleError();
  const generated = [];
  let committed = false;
  let compiled = null;
  try {
    compiled = await compile(job.mode, job.config, job);
    if (!compiled || typeof compiled !== 'object') throw new TypeError('compile must return a compiled generator');
    if (!isCurrent(job)) throw staleError();

    if (typeof compiled.sampleBatch === 'function') {
      const batch = await compiled.sampleBatch(job.quantity, job);
      if (!Array.isArray(batch)) throw new TypeError('sampleBatch must return an array');
      generated.push(...batch);
      if (batch.length !== job.quantity) {
        throw new RangeError(`sampleBatch must return exactly ${job.quantity} results`);
      }
      if (!isCurrent(job)) throw staleError();
    } else {
      requireFunction(compiled.sampleOne, 'compiled.sampleOne');
      for (let index = 0; index < job.quantity; index += 1) {
        const result = await compiled.sampleOne(index, job);
        generated.push(result);
        if (!isCurrent(job)) throw staleError();
      }
    }

    committed = true;
    return Object.freeze([...generated]);
  } finally {
    try {
      if (!committed) {
        for (const result of generated) {
          if (result !== null && result !== undefined) clearResult(result);
        }
      }
    } finally {
      if (compiled && typeof compiled.dispose === 'function') await compiled.dispose();
    }
  }
}

