import { log2BigInt } from './combinatorics.mjs';
import { weightedBigIntChoice } from './random-core.mjs';
import { createGenerationResult, deepFreeze } from './result-model.mjs';

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 32;
const DIGITS = Object.freeze([...'0123456789']);
const KEYPAD_PATHS = Object.freeze([
  '1234567890', '0987654321',
  '1472580369', '9630852741',
  '159', '951', '357', '753',
  '2580', '0852', '1470', '0741', '3690', '0963',
]);
const riskInternals = new WeakMap();
const blockedCompletionCounterCaches = new WeakMap();
const explicitBlockedIndexCaches = new WeakMap();
const datePatternCache = new Map();
const keypadPatternCache = new Map();
const sequencePatternCache = new Map();
const sequentialPeriodTableCache = new Map();

function requireBoolean(config, name, fallback) {
  const value = config[name] === undefined ? fallback : config[name];
  if (typeof value !== 'boolean') throw new TypeError(`${name} 必须是布尔值。`);
  return value;
}

function normalizePinConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('PIN config 必须是对象。');
  }
  const length = config.length ?? 6;
  if (!Number.isSafeInteger(length) || length < MIN_PIN_LENGTH || length > MAX_PIN_LENGTH) {
    throw new RangeError(`PIN 长度必须是 ${MIN_PIN_LENGTH}～${MAX_PIN_LENGTH} 位。`);
  }
  const allowRepeated = requireBoolean(config, 'allowRepeated', true);
  if (!allowRepeated && length > DIGITS.length) {
    throw new RangeError('禁止重复数字时，PIN 最长只能为 10 位。');
  }
  return deepFreeze({
    length,
    allowLeadingZero: requireBoolean(config, 'allowLeadingZero', true),
    allowRepeated,
    limitSequential: requireBoolean(config, 'limitSequential', true),
    blockWeak: requireBoolean(config, 'blockWeak', false),
  });
}

function nextSequenceState(lastDigit, direction, runLength, nextDigit) {
  if (lastDigit < 0) return { direction: 0, runLength: 1 };
  const delta = nextDigit - lastDigit;
  const nextDirection = delta === 1 ? 1 : delta === -1 ? -1 : 0;
  if (nextDirection === 0) return { direction: 0, runLength: 1 };
  return {
    direction: nextDirection,
    runLength: nextDirection === direction ? runLength + 1 : 2,
  };
}

function createBaseCounter(normalized) {
  const memo = new Map();
  const count = (position, lastDigit, direction, runLength, usedMask) => {
    if (position === normalized.length) return 1n;
    const key = `${position}|${lastDigit}|${direction}|${runLength}|${usedMask}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let total = 0n;
    for (let digit = 0; digit <= 9; digit += 1) {
      if (position === 0 && !normalized.allowLeadingZero && digit === 0) continue;
      if (!normalized.allowRepeated && (usedMask & (1 << digit))) continue;
      const next = nextSequenceState(lastDigit, direction, runLength, digit);
      if (normalized.limitSequential && next.runLength > 2) continue;
      total += count(
        position + 1,
        digit,
        next.direction,
        next.runLength,
        normalized.allowRepeated ? 0 : usedMask | (1 << digit),
      );
    }
    memo.set(key, total);
    return total;
  };
  return count;
}

function stateForPrefix(prefix, normalized) {
  const value = String(prefix ?? '');
  if (!/^\d*$/.test(value) || value.length > normalized.length) return null;
  let lastDigit = -1;
  let direction = 0;
  let runLength = 0;
  let usedMask = 0;
  for (let position = 0; position < value.length; position += 1) {
    const digit = Number(value[position]);
    if (position === 0 && !normalized.allowLeadingZero && digit === 0) return null;
    if (!normalized.allowRepeated && (usedMask & (1 << digit))) return null;
    const next = nextSequenceState(lastDigit, direction, runLength, digit);
    if (normalized.limitSequential && next.runLength > 2) return null;
    lastDigit = digit;
    direction = next.direction;
    runLength = next.runLength;
    if (!normalized.allowRepeated) usedMask |= 1 << digit;
  }
  return { position: value.length, lastDigit, direction, runLength, usedMask };
}

function baseConstraintAllows(pin, normalized) {
  const state = stateForPrefix(pin, normalized);
  return state !== null && state.position === normalized.length;
}

function decodeBase64(value, label) {
  if (typeof value !== 'string'
    || !value.length
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new TypeError(`${label} 格式无效。`);
  }
  try {
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(value, 'base64'));
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new TypeError(`${label} 格式无效。`);
  }
}

function decodeUint16LE(value) {
  const bytes = decodeBase64(value, '4 位 PIN 风险库');
  if (bytes.length % 2) throw new RangeError('4 位 PIN 风险库字节长度无效。');
  const output = new Uint16Array(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < output.length; index += 1) output[index] = view.getUint16(index * 2, true);
  return output;
}

function decodeUint32LE(value) {
  const bytes = decodeBase64(value, '6 位 PIN 风险库');
  if (bytes.length % 4) throw new RangeError('6 位 PIN 风险库字节长度无效。');
  const output = new Uint32Array(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < output.length; index += 1) output[index] = view.getUint32(index * 4, true);
  return output;
}

function createPrefixTrie(values) {
  const root = { terminal: false, children: new Map() };
  for (const value of values) {
    let node = root;
    for (const digit of value) {
      if (!node.children.has(digit)) {
        node.children.set(digit, { terminal: false, children: new Map() });
      }
      node = node.children.get(digit);
    }
    node.terminal = true;
  }
  return root;
}

function prefixTrieContains(root, value) {
  let node = root;
  for (const digit of value) {
    node = node.children.get(digit);
    if (!node) return false;
  }
  return node.terminal;
}

export function createPinRiskIndex(payload) {
  if (!payload || payload.encoding !== 'little-endian-typed-array-base64' || !payload.metadata) {
    throw new TypeError('PIN 风险库格式无效。');
  }
  const fourDigitRanks = decodeUint16LE(payload.fourDigitRanks);
  const sixDigitValues = decodeUint32LE(payload.sixDigitValues);
  if (fourDigitRanks.length !== payload.metadata.fourDigitCount) {
    throw new RangeError('4 位 PIN 风险库数量不匹配。');
  }
  if (sixDigitValues.length !== payload.metadata.sixDigitCount) {
    throw new RangeError('6 位 PIN 风险库数量不匹配。');
  }
  const sixDigitRanks = new Map();
  sixDigitValues.forEach((value, index) => sixDigitRanks.set(String(value).padStart(6, '0'), index + 1));
  if (sixDigitRanks.size !== sixDigitValues.length) {
    throw new RangeError('6 位 PIN 风险库包含重复值。');
  }
  const fourDigitBlocked = [];
  for (let value = 0; value < fourDigitRanks.length; value += 1) {
    const rank = Number(fourDigitRanks[value]);
    if (rank > 0 && rank <= payload.metadata.fourDigitBlockRank) {
      fourDigitBlocked.push(String(value).padStart(4, '0'));
    }
  }
  const sixDigitBlocked = [...sixDigitRanks.entries()]
    .filter(([, rank]) => rank <= payload.metadata.sixDigitBlockRank)
    .map(([pin]) => pin);
  const blockedTrie = createPrefixTrie([...fourDigitBlocked, ...sixDigitBlocked]);
  const internal = {
    fourDigitRanks,
    sixDigitRanks,
    blockedTrie,
    blockedValues: new Map([[4, fourDigitBlocked], [6, sixDigitBlocked]]),
  };
  const sources = Object.fromEntries(
    Object.entries(payload.sources ?? {}).map(([name, source]) => [name, { ...source }]),
  );
  const index = {
    status: 'ready',
    version: String(payload.version ?? ''),
    sourceSha256: payload.sourceSha256 ?? null,
    metadata: deepFreeze({ ...payload.metadata }),
    sources: deepFreeze(sources),
    rank(pin) {
      const value = String(pin ?? '');
      if (/^\d{4}$/.test(value)) return Number(internal.fourDigitRanks[Number(value)] || 0) || null;
      if (/^\d{6}$/.test(value)) return internal.sixDigitRanks.get(value) ?? null;
      return null;
    },
    isRankBlocked(pin) {
      const value = String(pin ?? '');
      return /^\d{4}$|^\d{6}$/.test(value) && prefixTrieContains(internal.blockedTrie, value);
    },
  };
  riskInternals.set(index, internal);
  return Object.freeze(index);
}

function requireReadyRiskIndex(riskIndex) {
  if (!riskIndex || riskIndex.status !== 'ready' || !riskInternals.has(riskIndex)) {
    throw new Error('blockWeak 要求 PIN 风险模型处于 ready 状态。');
  }
  return riskIndex;
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function twoDigits(value) {
  return String(value).padStart(2, '0');
}

function datePatternsForLength(length) {
  if (datePatternCache.has(length)) return datePatternCache.get(length);
  const values = new Set();
  if (length === 4) {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= daysInMonth(2000, month); day += 1) {
        const mm = twoDigits(month);
        const dd = twoDigits(day);
        values.add(`${mm}${dd}`);
        values.add(`${dd}${mm}`);
      }
    }
  } else if (length === 6) {
    for (let shortYear = 0; shortYear <= 99; shortYear += 1) {
      const yy = twoDigits(shortYear);
      const year = 2000 + shortYear;
      for (let month = 1; month <= 12; month += 1) {
        for (let day = 1; day <= daysInMonth(year, month); day += 1) {
          const mm = twoDigits(month);
          const dd = twoDigits(day);
          values.add(`${yy}${mm}${dd}`);
          values.add(`${mm}${dd}${yy}`);
          values.add(`${dd}${mm}${yy}`);
        }
      }
    }
  } else if (length === 8) {
    for (let year = 1900; year <= 2099; year += 1) {
      const yyyy = String(year);
      for (let month = 1; month <= 12; month += 1) {
        for (let day = 1; day <= daysInMonth(year, month); day += 1) {
          const mm = twoDigits(month);
          const dd = twoDigits(day);
          values.add(`${yyyy}${mm}${dd}`);
          values.add(`${mm}${dd}${yyyy}`);
          values.add(`${dd}${mm}${yyyy}`);
        }
      }
    }
  }
  datePatternCache.set(length, values);
  return values;
}

function sequencePatternsForLength(length) {
  if (sequencePatternCache.has(length)) return sequencePatternCache.get(length);
  const values = new Set();
  for (let start = 0; start <= 9; start += 1) {
    for (const direction of [-1, 1]) {
      let value = '';
      for (let index = 0; index < length; index += 1) {
        value += String((start + direction * index + 1000) % 10);
      }
      values.add(value);
    }
  }
  sequencePatternCache.set(length, values);
  return values;
}

function keypadPatternsForLength(length) {
  if (keypadPatternCache.has(length)) return keypadPatternCache.get(length);
  const values = new Set();
  for (const path of KEYPAD_PATHS) {
    if (path.length >= length) {
      for (let start = 0; start <= path.length - length; start += 1) {
        values.add(path.slice(start, start + length));
      }
      continue;
    }
    values.add(path.repeat(Math.ceil(length / path.length)).slice(0, length));
  }
  keypadPatternCache.set(length, values);
  return values;
}

function isShortCycle(value) {
  for (let width = 1; width <= Math.floor(value.length / 2); width += 1) {
    if (value.length % width !== 0) continue;
    let matches = true;
    for (let index = width; index < value.length; index += 1) {
      if (value[index] !== value[index % width]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

export function detectWeakPinPatterns(pin) {
  const value = String(pin ?? '');
  if (!/^\d{4,32}$/.test(value)) return [];
  const patterns = [];
  const allRepeated = /^(\d)\1+$/.test(value);
  if (allRepeated) patterns.push('全部重复');
  if (!allRepeated && isShortCycle(value)) patterns.push('短周期循环');
  if (sequencePatternsForLength(value.length).has(value)) patterns.push('连续数字');
  if (datePatternsForLength(value.length).has(value)) patterns.push('日期样式');
  if (keypadPatternsForLength(value.length).has(value)) patterns.push('键盘路径');
  return patterns;
}

function hasForbiddenTriple(first, second, third) {
  return second - first === third - second && Math.abs(second - first) === 1;
}

function fixedDigitsForPeriod(prefix, period) {
  const fixedDigits = Array(period).fill(-1);
  for (let position = 0; position < prefix.length; position += 1) {
    const periodPosition = position % period;
    const digit = Number(prefix[position]);
    if (fixedDigits[periodPosition] >= 0 && fixedDigits[periodPosition] !== digit) return null;
    fixedDigits[periodPosition] = digit;
  }
  return fixedDigits;
}

function choicesAtPosition(fixedDigits, position, allowLeadingZero) {
  if (fixedDigits[position] >= 0) return [fixedDigits[position]];
  return position === 0 && !allowLeadingZero
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
    : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
}

function periodStateIndex(first, second, beforeLast, last) {
  return ((first * 10 + second) * 10 + beforeLast) * 10 + last;
}

function sequentialPeriodTables(period) {
  if (sequentialPeriodTableCache.has(period)) return sequentialPeriodTableCache.get(period);
  if (period < 3 || period > Math.floor(MAX_PIN_LENGTH / 2)) {
    throw new RangeError('周期 DP 长度超出安全表范围。');
  }
  const tables = Array(period + 1);
  const terminal = new BigUint64Array(10_000);
  for (let first = 0; first <= 9; first += 1) {
    for (let second = 0; second <= 9; second += 1) {
      for (let beforeLast = 0; beforeLast <= 9; beforeLast += 1) {
        for (let last = 0; last <= 9; last += 1) {
          if (hasForbiddenTriple(beforeLast, last, first)) continue;
          if (hasForbiddenTriple(last, first, second)) continue;
          terminal[periodStateIndex(first, second, beforeLast, last)] = 1n;
        }
      }
    }
  }
  tables[period] = terminal;
  for (let position = period - 1; position >= 2; position -= 1) {
    const current = new BigUint64Array(10_000);
    const next = tables[position + 1];
    for (let first = 0; first <= 9; first += 1) {
      for (let second = 0; second <= 9; second += 1) {
        for (let beforeLast = 0; beforeLast <= 9; beforeLast += 1) {
          for (let last = 0; last <= 9; last += 1) {
            let total = 0n;
            for (let digit = 0; digit <= 9; digit += 1) {
              if (hasForbiddenTriple(beforeLast, last, digit)) continue;
              total += next[periodStateIndex(first, second, last, digit)];
            }
            current[periodStateIndex(first, second, beforeLast, last)] = total;
          }
        }
      }
    }
    tables[position] = current;
  }
  sequentialPeriodTableCache.set(period, tables);
  return tables;
}

function countPeriodDividing(normalized, period, prefix = '') {
  if (!normalized.allowRepeated) return 0n;
  const fixedDigits = fixedDigitsForPeriod(prefix, period);
  if (!fixedDigits) return 0n;
  if (!normalized.allowLeadingZero && fixedDigits[0] === 0) return 0n;
  if (!normalized.limitSequential) {
    let total = 1n;
    for (let position = 0; position < period; position += 1) {
      total *= BigInt(choicesAtPosition(
        fixedDigits,
        position,
        normalized.allowLeadingZero,
      ).length);
    }
    return total;
  }
  if (period <= 2) {
    let total = BigInt(choicesAtPosition(
      fixedDigits,
      0,
      normalized.allowLeadingZero,
    ).length);
    if (period === 2) {
      total *= BigInt(choicesAtPosition(fixedDigits, 1, true).length);
    }
    return total;
  }
  const tables = sequentialPeriodTables(period);
  const constrainedLength = Math.min(prefix.length, period);
  let total = 0n;
  if (constrainedLength <= 1) {
    for (const first of choicesAtPosition(fixedDigits, 0, normalized.allowLeadingZero)) {
      for (const second of choicesAtPosition(fixedDigits, 1, true)) {
        total += tables[2][periodStateIndex(first, second, first, second)];
      }
    }
    return total;
  }
  const first = fixedDigits[0];
  const second = fixedDigits[1];
  const beforeLast = fixedDigits[constrainedLength - 2];
  const last = fixedDigits[constrainedLength - 1];
  return tables[constrainedLength][periodStateIndex(first, second, beforeLast, last)];
}

function countPeriodicBlocked(normalized, prefix = '') {
  if (!normalized.allowRepeated) return 0n;
  const divisors = [];
  for (let divisor = 1; divisor < normalized.length; divisor += 1) {
    if (normalized.length % divisor === 0) divisors.push(divisor);
  }
  const primitiveCounts = new Map();
  let total = 0n;
  for (const divisor of divisors) {
    let primitive = countPeriodDividing(normalized, divisor, prefix);
    for (const [smaller, count] of primitiveCounts) {
      if (divisor % smaller === 0) primitive -= count;
    }
    primitiveCounts.set(divisor, primitive);
    total += primitive;
  }
  return total;
}

function explicitWeakCandidates(length, riskIndex) {
  const values = new Set([
    ...sequencePatternsForLength(length),
    ...keypadPatternsForLength(length),
    ...datePatternsForLength(length),
  ]);
  const ranked = riskInternals.get(riskIndex)?.blockedValues.get(length) ?? [];
  ranked.forEach((value) => values.add(value));
  return values;
}

function lowerBound(values, target, inclusiveUpper = false) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const beforeBoundary = inclusiveUpper
      ? values[middle] <= target
      : values[middle] < target;
    if (beforeBoundary) low = middle + 1;
    else high = middle;
  }
  return low;
}

function explicitBlockedPrefixCounter(normalized, riskIndex) {
  let cache = explicitBlockedIndexCaches.get(riskIndex);
  if (!cache) {
    cache = new Map();
    explicitBlockedIndexCaches.set(riskIndex, cache);
  }
  const cacheKey = [
    normalized.length,
    normalized.allowLeadingZero,
    normalized.allowRepeated,
    normalized.limitSequential,
  ].join('|');
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const values = [...explicitWeakCandidates(normalized.length, riskIndex)]
    .filter((value) => !isShortCycle(value) && baseConstraintAllows(value, normalized))
    .sort();
  const count = (prefix) => {
    const remaining = normalized.length - prefix.length;
    const first = `${prefix}${'0'.repeat(remaining)}`;
    const last = `${prefix}${'9'.repeat(remaining)}`;
    return BigInt(
      lowerBound(values, last, true) - lowerBound(values, first),
    );
  };
  cache.set(cacheKey, count);
  return count;
}

function createBlockedCompletionCounter(normalized, riskIndex) {
  let cache = blockedCompletionCounterCaches.get(riskIndex);
  if (!cache) {
    cache = new Map();
    blockedCompletionCounterCaches.set(riskIndex, cache);
  }
  const cacheKey = [
    normalized.length,
    normalized.allowLeadingZero,
    normalized.allowRepeated,
    normalized.limitSequential,
  ].join('|');
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const explicitCount = explicitBlockedPrefixCounter(normalized, riskIndex);
  const rootCount = countPeriodicBlocked(normalized) + explicitCount('');
  const count = (prefix = '') => {
    const value = String(prefix ?? '');
    if (!stateForPrefix(value, normalized)) return 0n;
    if (value.length === 0) return rootCount;
    return countPeriodicBlocked(normalized, value) + explicitCount(value);
  };
  cache.set(cacheKey, count);
  return count;
}

function countBlockedIntersection(normalized, riskIndex) {
  return createBlockedCompletionCounter(normalized, riskIndex)('');
}

export function countPinCompletions(config, riskIndex) {
  const normalized = normalizePinConfig(config);
  const counter = createBaseCounter(normalized);
  const baseSearchSpace = counter(0, -1, 0, 0, 0);
  if (!normalized.blockWeak) return baseSearchSpace;
  requireReadyRiskIndex(riskIndex);
  return baseSearchSpace - countBlockedIntersection(normalized, riskIndex);
}

export function createPinModel(config, riskIndex) {
  const normalized = normalizePinConfig(config);
  if (normalized.blockWeak) requireReadyRiskIndex(riskIndex);
  const counter = createBaseCounter(normalized);
  const baseSearchSpace = counter(0, -1, 0, 0, 0);
  const blockedCount = normalized.blockWeak
    ? countBlockedIntersection(normalized, riskIndex)
    : 0n;
  const blockedCompletionCount = normalized.blockWeak
    ? createBlockedCompletionCounter(normalized, riskIndex)
    : () => 0n;
  const searchSpace = baseSearchSpace - blockedCount;
  if (searchSpace <= 0n) throw new RangeError('当前 PIN 约束下没有合法输出。');
  const minEntropyBits = log2BigInt(searchSpace);

  const completionCount = (prefix = '') => {
    const state = stateForPrefix(prefix, normalized);
    if (!state) return 0n;
    const baseCount = counter(
      state.position,
      state.lastDigit,
      state.direction,
      state.runLength,
      state.usedMask,
    );
    return baseCount - blockedCompletionCount(prefix);
  };
  const branchCompletionCounts = (prefix = '') => {
    const value = String(prefix ?? '');
    const state = stateForPrefix(value, normalized);
    if (!state || state.position >= normalized.length) return Object.freeze([]);
    const branches = [];
    for (const digit of DIGITS) {
      const nextPrefix = value + digit;
      const count = completionCount(nextPrefix);
      if (count > 0n) branches.push(Object.freeze({ digit, count }));
    }
    return Object.freeze(branches);
  };

  return Object.freeze({
    type: 'pin',
    kind: 'uniform-constrained-pin',
    normalized,
    configSnapshot: normalized,
    baseSearchSpace,
    blockedCount,
    searchSpace,
    sourceEntropyBits: minEntropyBits,
    minEntropyBits,
    shannonEntropyBits: minEntropyBits,
    averageGuessBits: Math.max(0, minEntropyBits - 1),
    alphabet: '0123456789',
    poolSizes: deepFreeze({ digit: 10 }),
    encoding: 'decimal-digits',
    standard: 'uniform-constrained-pin-v2',
    riskVersion: normalized.blockWeak ? riskIndex.version : null,
    completionCount,
    branchCompletionCounts,
  });
}

function sampleAllowedPin(model, cryptoLike) {
  let value = '';
  while (value.length < model.normalized.length) {
    const branches = model.branchCompletionCounts(value);
    value += weightedBigIntChoice(
      branches.map((branch) => branch.digit),
      branches.map((branch) => branch.count),
      cryptoLike,
    );
  }
  return value;
}

export function generatePin(config, riskIndex, cryptoLike = globalThis.crypto) {
  const model = createPinModel(config, riskIndex);
  const value = sampleAllowedPin(model, cryptoLike);

  const {
    normalized: _normalized,
    configSnapshot,
    completionCount: _completionCount,
    branchCompletionCounts: _branchCompletionCounts,
    type: _type,
    ...generationModel
  } = model;
  return createGenerationResult({
    type: 'pin',
    schemeId: 'uniform-constrained-pin-v2',
    value,
    configSnapshot,
    generationModel,
  });
}
