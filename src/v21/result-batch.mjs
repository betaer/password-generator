function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

export function createBatchRequestSnapshot(mode, config) {
  if (typeof mode !== 'string' || !mode.trim()) throw new TypeError('批次请求 mode 必须是非空字符串');
  if (!isPlainObject(config)) throw new TypeError('批次请求 config 必须是 plain object');
  return deepFreeze({ mode, config: structuredClone(config) });
}

export function createBatchPresentationSnapshot(result, quantity) {
  if (!isPlainObject(result) || typeof result.id !== 'string' || !result.id) {
    throw new TypeError('批次展示源必须是有效结果');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new RangeError('批次数量必须是正整数');
  if (typeof result.type !== 'string' || !result.type || !isPlainObject(result.configSnapshot) || !isPlainObject(result.generationModel)) {
    throw new TypeError('批次展示源缺少概率模型');
  }
  return deepFreeze({
    id: `batch:${result.id}`,
    type: result.type,
    schemaVersion: result.schemaVersion,
    configSnapshot: structuredClone(result.configSnapshot),
    generationModel: structuredClone(result.generationModel),
    quantity,
    randomByteLength: result.bytes instanceof Uint8Array ? result.bytes.byteLength : null,
    checksumValid: result.type === 'mnemonic' ? result.checksumValid === true : null,
  });
}

export function replaceResultById(results, id, replacement) {
  if (!Array.isArray(results)) throw new TypeError('results 必须是数组');
  if (typeof id !== 'string' || !id) throw new TypeError('id 必须是非空字符串');
  if (!isPlainObject(replacement) || typeof replacement.id !== 'string' || !replacement.id) {
    throw new TypeError('replacement 必须包含有效 id');
  }
  const index = results.findIndex((result) => result?.id === id);
  if (index < 0) throw new RangeError('待替换结果不存在');
  if (results.some((result, position) => position !== index && result?.id === replacement.id)) {
    throw new RangeError('replacement id 与现有结果重复');
  }
  const next = [...results];
  next[index] = replacement;
  return next;
}

export function hasDuplicateResultValue(results, excludedId, replacement) {
  if (!Array.isArray(results)) throw new TypeError('results 必须是数组');
  if (!replacement || typeof replacement.value !== 'string') throw new TypeError('replacement value 必须是字符串');
  return results.some((result) => result?.id !== excludedId && result?.value === replacement.value);
}

export function shouldRejectUniqueReplacement(results, excludedId, replacement, request) {
  if (!isPlainObject(request) || typeof request.mode !== 'string' || !isPlainObject(request.config)) {
    throw new TypeError('request 必须包含 mode 与 config');
  }
  return request.mode === 'pin'
    && request.config.uniqueWithinBatch !== false
    && hasDuplicateResultValue(results, excludedId, replacement);
}

export function aggregatePatternStates(results, patterns, options = {}) {
  if (!Array.isArray(results)) throw new TypeError('results 必须是数组');
  if (!(patterns instanceof Map)) throw new TypeError('patterns 必须是 Map');
  const typeFilter = Array.isArray(options.analyzableTypes) ? new Set(options.analyzableTypes) : null;
  const analyzable = typeFilter ? results.filter((result) => typeFilter.has(result?.type)) : results;
  const summary = { total: analyzable.length, completed: 0, risky: 0, loading: 0, failed: 0 };
  for (const result of analyzable) {
    const pattern = patterns.get(result.id);
    if (pattern?.status === 'ready') {
      summary.completed += 1;
      if (Array.isArray(pattern.sequences) && pattern.sequences.length) summary.risky += 1;
    } else if (pattern?.status === 'loading' || pattern?.status === 'idle') {
      summary.loading += 1;
    } else {
      summary.failed += 1;
    }
  }
  return Object.freeze(summary);
}
