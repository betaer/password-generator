import { log2BigInt } from '../v2/combinatorics.mjs';

const EXACT_POWER_OF_TWO_LIMIT = 4096;

function groupDigits(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

export function createIntegerSearchSpace(value) {
  if (typeof value !== 'bigint') throw new TypeError('search-space value must be a BigInt');
  if (value <= 0n) throw new RangeError('search-space value must be positive');
  return Object.freeze({ kind: 'integer', value });
}

export function createPowerOfTwoSearchSpace(exponent) {
  if (typeof exponent !== 'number' || !Number.isSafeInteger(exponent)) {
    throw new TypeError('power-of-two exponent must be a safe integer');
  }
  if (exponent < 0) throw new RangeError('power-of-two exponent must not be negative');
  return Object.freeze({ kind: 'power-of-two', exponent });
}

export function normalizeSearchSpace(searchSpace) {
  if (typeof searchSpace === 'bigint') return createIntegerSearchSpace(searchSpace);
  if (!searchSpace || typeof searchSpace !== 'object' || Array.isArray(searchSpace)) {
    throw new TypeError('searchSpace must be an integer or power-of-two descriptor');
  }
  if (searchSpace.kind === 'integer') return createIntegerSearchSpace(searchSpace.value);
  if (searchSpace.kind === 'power-of-two') return createPowerOfTwoSearchSpace(searchSpace.exponent);
  throw new RangeError(`unsupported search-space kind: ${String(searchSpace.kind)}`);
}

export function probabilityBits(searchSpace) {
  const normalized = normalizeSearchSpace(searchSpace);
  return normalized.kind === 'integer'
    ? log2BigInt(normalized.value)
    : normalized.exponent;
}

export function expectedRankForSearchSpace(searchSpace) {
  const normalized = normalizeSearchSpace(searchSpace);
  if (normalized.kind === 'power-of-two' && normalized.exponent > EXACT_POWER_OF_TWO_LIMIT) {
    return Object.freeze({
      kind: 'symbolic-power-of-two',
      exponent: normalized.exponent,
      denominator: 2n,
      bits: Math.max(0, normalized.exponent - 1),
    });
  }

  const size = normalized.kind === 'integer'
    ? normalized.value
    : 1n << BigInt(normalized.exponent);
  const numerator = size + 1n;
  return Object.freeze({
    kind: 'rational',
    numerator,
    denominator: 2n,
    bits: Math.max(0, log2BigInt(numerator) - 1),
  });
}

export function formatSearchSpace(searchSpace) {
  const normalized = normalizeSearchSpace(searchSpace);
  if (normalized.kind === 'power-of-two') {
    return `2^${groupDigits(normalized.exponent)}`;
  }
  const digits = normalized.value.toString();
  if (digits.length <= 18) return groupDigits(digits);
  return `${digits[0]}.${digits.slice(1, 4)}e+${digits.length - 1}`;
}

export function formatExpectedRank(expectedRank) {
  if (!expectedRank || typeof expectedRank !== 'object') {
    throw new TypeError('expectedRank must be an object');
  }
  if (expectedRank.kind === 'symbolic-power-of-two') {
    return `(2^${groupDigits(expectedRank.exponent)} + 1) / 2`;
  }
  if (expectedRank.kind !== 'rational'
    || typeof expectedRank.numerator !== 'bigint'
    || expectedRank.denominator !== 2n) {
    throw new TypeError('expectedRank must be a supported exact rank');
  }
  const whole = expectedRank.numerator / 2n;
  return expectedRank.numerator % 2n === 0n
    ? groupDigits(whole.toString())
    : `${groupDigits(whole.toString())}.5`;
}

