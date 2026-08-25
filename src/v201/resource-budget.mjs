export const MAX_BATCH_RAW_BYTES = 8 * 1024 * 1024;
export const MAX_HISTORY_RAW_BYTES = 8 * 1024 * 1024;
export const MAX_CLIPBOARD_CHARACTERS = 4 * 1024 * 1024;
export const MAX_RENDER_CHARACTERS = 4096;
export const MAX_ANALYZER_CHARACTERS = 512;
export const LARGE_RANDOM_BYTES_THRESHOLD = 64 * 1024;

function requireNonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
}

export function assertBatchBudget({ mode, byteLength = 0, quantity }) {
  requireNonNegativeSafeInteger(byteLength, 'byteLength');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new RangeError('quantity must be between 1 and 100');
  }
  if (mode === 'randomBytes' && byteLength >= LARGE_RANDOM_BYTES_THRESHOLD && quantity !== 1) {
    throw new RangeError('Random Bytes 达到 64 KiB 时 quantity / 数量必须为 1。');
  }
  const total = byteLength * quantity;
  if (!Number.isSafeInteger(total) || total > MAX_BATCH_RAW_BYTES) {
    throw new RangeError('批次原始随机数据不得超过 8 MiB。');
  }
  return Object.freeze({ byteLength, quantity, totalRawBytes: total });
}

export function assertClipboardBudget(characterCount) {
  requireNonNegativeSafeInteger(characterCount, 'characterCount');
  if (characterCount > MAX_CLIPBOARD_CHARACTERS) {
    throw new RangeError('结果超过 4 MiB 剪贴板预算，请改用下载。');
  }
  return characterCount;
}

export function createHistoryBudget({
  maxEntries = 100,
  maxBytes = MAX_HISTORY_RAW_BYTES,
  estimateBytes,
  clearEntry,
} = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be positive');
  requireNonNegativeSafeInteger(maxBytes, 'maxBytes');
  if (typeof estimateBytes !== 'function' || typeof clearEntry !== 'function') {
    throw new TypeError('estimateBytes and clearEntry must be functions');
  }
  let entries = [];
  let totalBytes = 0;

  const api = {
    add(incoming) {
      if (!Array.isArray(incoming)) throw new TypeError('history entries must be an array');
      const accepted = incoming.filter((entry) => {
        const bytes = requireNonNegativeSafeInteger(estimateBytes(entry), 'history entry bytes');
        return bytes <= maxBytes;
      });
      const incomingIds = new Set(accepted.map((entry) => entry.id));
      entries = [...accepted, ...entries.filter((entry) => !incomingIds.has(entry.id))];
      totalBytes = entries.reduce((total, entry) => total + estimateBytes(entry), 0);
      while (entries.length > maxEntries || totalBytes > maxBytes) {
        const removed = entries.pop();
        totalBytes -= estimateBytes(removed);
        clearEntry(removed);
      }
      return Object.freeze([...accepted.filter((entry) => entries.includes(entry))]);
    },
    clear() {
      for (const entry of entries) clearEntry(entry);
      entries = [];
      totalBytes = 0;
    },
    get entries() { return Object.freeze([...entries]); },
    get totalBytes() { return totalBytes; },
  };
  return Object.freeze(api);
}

export function estimateResultRetentionBytes(result) {
  if (!result || typeof result !== 'object') return 0;
  const binary = result.bytes instanceof Uint8Array ? result.bytes.byteLength : 0;
  const text = typeof result.value === 'string' ? result.value.length * 2 : 0;
  const preview = typeof result.preview === 'string' ? result.preview.length * 2 : 0;
  return binary + text + preview;
}

