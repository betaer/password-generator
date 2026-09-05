const WEB_CRYPTO_MAX_BYTES_PER_CALL = 65_536;

function requireCrypto(cryptoLike) {
  if (!cryptoLike || typeof cryptoLike.getRandomValues !== 'function') {
    throw new TypeError('Web Crypto getRandomValues is required');
  }
  return cryptoLike;
}

function requirePositiveLength(length) {
  if (typeof length !== 'number') {
    throw new TypeError('length must be a number');
  }
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError('length must be a positive safe integer');
  }
}

function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Returns fresh cryptographically secure bytes. Large requests are split because
 * Web Crypto limits each getRandomValues call to 65,536 bytes.
 */
export function secureRandomBytes(length, cryptoLike = globalThis.crypto) {
  requirePositiveLength(length);
  const randomSource = requireCrypto(cryptoLike);
  const output = new Uint8Array(length);

  try {
    for (let offset = 0; offset < length; offset += WEB_CRYPTO_MAX_BYTES_PER_CALL) {
      const end = Math.min(length, offset + WEB_CRYPTO_MAX_BYTES_PER_CALL);
      randomSource.getRandomValues(output.subarray(offset, end));
    }
  } catch (error) {
    // A source can fail after partially filling a chunk, before any result exists.
    output.fill(0);
    throw error;
  }

  return output;
}

/**
 * Draws an exact uniform BigInt in [0, maxExclusive) using rejection sampling.
 */
export function secureBigIntBelow(maxExclusive, cryptoLike = globalThis.crypto) {
  if (typeof maxExclusive !== 'bigint') {
    throw new TypeError('maxExclusive must be a BigInt');
  }
  if (maxExclusive <= 0n) {
    throw new RangeError('maxExclusive must be positive');
  }

  const randomSource = requireCrypto(cryptoLike);
  if (maxExclusive === 1n) {
    return 0n;
  }

  const bitLength = (maxExclusive - 1n).toString(2).length;
  const byteLength = Math.ceil(bitLength / 8);
  const unusedHighBits = byteLength * 8 - bitLength;
  const highByteMask = 0xff >>> unusedHighBits;

  while (true) {
    const bytes = secureRandomBytes(byteLength, randomSource);
    bytes[0] &= highByteMask;
    const candidate = bytesToBigInt(bytes);
    if (candidate < maxExclusive) {
      return candidate;
    }
  }
}

/**
 * Draws an exact uniform safe integer in [0, maxExclusive).
 */
export function secureInt(maxExclusive, cryptoLike = globalThis.crypto) {
  if (typeof maxExclusive !== 'number') {
    throw new TypeError('maxExclusive must be a number');
  }
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive must be a positive safe integer');
  }
  return Number(secureBigIntBelow(BigInt(maxExclusive), cryptoLike));
}

/**
 * Selects a value with probability weight / sum(weights), preserving BigInt
 * precision even when the completion counts exceed Number.MAX_SAFE_INTEGER.
 */
export function weightedBigIntChoice(values, weights, cryptoLike = globalThis.crypto) {
  if (!Array.isArray(values) || !Array.isArray(weights)) {
    throw new TypeError('values and weights must be arrays');
  }
  if (values.length === 0) {
    throw new RangeError('values and weights must not be empty');
  }
  if (values.length !== weights.length) {
    throw new RangeError('values and weights must have the same length');
  }

  let totalWeight = 0n;
  for (const weight of weights) {
    if (typeof weight !== 'bigint') {
      throw new TypeError('every weight must be a BigInt');
    }
    if (weight < 0n) {
      throw new RangeError('weights must not be negative');
    }
    totalWeight += weight;
  }
  if (totalWeight === 0n) {
    throw new RangeError('at least one weight must be positive');
  }

  const draw = secureBigIntBelow(totalWeight, cryptoLike);
  let cumulativeWeight = 0n;
  for (let index = 0; index < values.length; index += 1) {
    cumulativeWeight += weights[index];
    if (draw < cumulativeWeight) {
      return values[index];
    }
  }

  throw new Error('weighted choice invariant violated');
}

/**
 * Returns a shuffled copy using unbiased Fisher-Yates indices.
 */
export function secureShuffle(values, cryptoLike = globalThis.crypto) {
  if (!Array.isArray(values)) {
    throw new TypeError('values must be an array');
  }

  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = secureInt(index + 1, cryptoLike);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
