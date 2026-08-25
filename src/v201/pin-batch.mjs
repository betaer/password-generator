import { secureBigIntBelow } from '../v2/random-core.mjs';

function requirePinModel(model) {
  if (!model || model.kind !== 'uniform-constrained-pin'
    || typeof model.searchSpace !== 'bigint'
    || typeof model.branchCompletionCounts !== 'function') {
    throw new TypeError('model must be a compiled uniform PIN model');
  }
  return model;
}

export function unrankPin(model, rank) {
  const compiled = requirePinModel(model);
  if (typeof rank !== 'bigint') throw new TypeError('PIN rank must be a BigInt');
  if (rank < 0n || rank >= compiled.searchSpace) throw new RangeError('PIN rank is outside the legal space');

  let remainingRank = rank;
  let prefix = '';
  while (prefix.length < compiled.normalized.length) {
    const branches = compiled.branchCompletionCounts(prefix);
    let selected = null;
    for (const branch of branches) {
      if (remainingRank < branch.count) {
        selected = branch.digit;
        break;
      }
      remainingRank -= branch.count;
    }
    if (selected === null) throw new Error('PIN unrank invariant violated');
    prefix += selected;
  }
  return prefix;
}

/**
 * Partial Fisher-Yates over the implicit rank range [0, N). The virtual map
 * keeps memory O(quantity), while every ordered unique batch remains uniform.
 */
export function sampleUniqueRanks(spaceSize, quantity, cryptoLike = globalThis.crypto) {
  if (typeof spaceSize !== 'bigint' || spaceSize <= 0n) {
    throw new RangeError('spaceSize must be a positive BigInt');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError('quantity must be a positive safe integer');
  }
  if (BigInt(quantity) > spaceSize) throw new RangeError('unique quantity exceeds the PIN search space');

  const remap = new Map();
  const ranks = [];
  for (let index = 0; index < quantity; index += 1) {
    const remaining = spaceSize - BigInt(index);
    const draw = secureBigIntBelow(remaining, cryptoLike);
    const last = remaining - 1n;
    const selected = remap.get(draw) ?? draw;
    const replacement = remap.get(last) ?? last;
    if (draw !== last) remap.set(draw, replacement);
    remap.delete(last);
    ranks.push(selected);
  }
  return Object.freeze(ranks);
}

export function sampleUniquePinBatch(model, quantity, cryptoLike = globalThis.crypto) {
  const compiled = requirePinModel(model);
  return Object.freeze(sampleUniqueRanks(compiled.searchSpace, quantity, cryptoLike)
    .map((rank) => unrankPin(compiled, rank)));
}

export function independentBatchCollisionProbability(spaceSize, quantity) {
  if (typeof spaceSize !== 'bigint' || spaceSize <= 0n) throw new RangeError('spaceSize must be positive');
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError('quantity must not be negative');
  if (quantity <= 1) return 0;
  if (BigInt(quantity) > spaceSize) return 1;

  if (spaceSize <= BigInt(Number.MAX_SAFE_INTEGER)) {
    const size = Number(spaceSize);
    let noCollision = 1;
    for (let index = 1; index < quantity; index += 1) {
      noCollision *= (size - index) / size;
    }
    return 1 - noCollision;
  }

  const bitLength = spaceSize.toString(2).length;
  if (bitLength > 1074) return 0;
  const leadingShift = Math.max(0, bitLength - 53);
  const approximateSize = Number(spaceSize >> BigInt(leadingShift)) * (2 ** leadingShift);
  const lambda = quantity * (quantity - 1) / (2 * approximateSize);
  return -Math.expm1(-lambda);
}

export function describePinPolicy(model, riskIndex) {
  const compiled = requirePinModel(model);
  if (!riskIndex || riskIndex.status !== 'ready') throw new TypeError('riskIndex must be ready');
  const length = compiled.normalized.length;
  return Object.freeze({
    name: 'Heuristic Common-PIN Exclusion Policy v1',
    version: riskIndex.version,
    sourceCommit: riskIndex.metadata?.sourceCommit ?? null,
    sourceSha256: riskIndex.sourceSha256 ?? null,
    sources: riskIndex.sources,
    rankThresholds: Object.freeze({
      fourDigit: riskIndex.metadata?.fourDigitBlockRank ?? null,
      sixDigit: riskIndex.metadata?.sixDigitBlockRank ?? null,
    }),
    rankedCorpusCoverage: '4-and-6-digits-only',
    currentLengthRankedCoverage: length === 4 || length === 6,
    ruleCoverage: Object.freeze([
      'short-cycle',
      'sequential-digits',
      'keypad-path',
      'date-1900-2099',
    ]),
    baseSearchSpace: compiled.baseSearchSpace,
    allowedSearchSpace: compiled.searchSpace,
    blockedCount: compiled.blockedCount,
    disclaimer: '公开过滤规则下，剩余 PIN 仍由生成器等概率抽样；本策略只描述 common-first 攻击启发式，不是额外随机熵。',
  });
}

