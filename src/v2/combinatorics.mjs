const factorialCache = [1n];

function requireInteger(value, name) {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

function requireNonNegativeInteger(value, name) {
  requireInteger(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must not be negative`);
  }
}

export function factorialBigInt(n) {
  requireNonNegativeInteger(n, 'n');

  for (let index = factorialCache.length; index <= n; index += 1) {
    factorialCache[index] = factorialCache[index - 1] * BigInt(index);
  }
  return factorialCache[n];
}

export function chooseBigInt(n, k) {
  requireNonNegativeInteger(n, 'n');
  requireInteger(k, 'k');
  if (k < 0 || k > n) {
    return 0n;
  }

  const selectedCount = Math.min(k, n - k);
  let result = 1n;
  for (let index = 1; index <= selectedCount; index += 1) {
    result = (result * BigInt(n - selectedCount + index)) / BigInt(index);
  }
  return result;
}

export function fallingFactorialBigInt(n, k) {
  requireNonNegativeInteger(n, 'n');
  requireInteger(k, 'k');
  if (k < 0 || k > n) {
    return 0n;
  }

  let result = 1n;
  for (let index = 0; index < k; index += 1) {
    result *= BigInt(n - index);
  }
  return result;
}

/**
 * Computes log2 without converting the full BigInt to Number. Only the leading
 * 53 bits are converted, keeping the result finite for arbitrarily large counts.
 */
export function log2BigInt(value) {
  if (typeof value !== 'bigint') {
    throw new TypeError('value must be a BigInt');
  }
  if (value <= 0n) {
    throw new RangeError('value must be positive');
  }

  const bitLength = value.toString(2).length;
  const shift = Math.max(0, bitLength - 53);
  const leading = Number(value >> BigInt(shift));
  return Math.log2(leading) + shift;
}

/**
 * Formats a BigInt in rounded ASCII scientific notation without Number
 * conversion, for example 123456789n -> "1.23e+8".
 */
export function formatBigIntScientific(value, significantDigits = 3) {
  if (typeof value !== 'bigint') {
    throw new TypeError('value must be a BigInt');
  }
  requireInteger(significantDigits, 'significantDigits');
  if (significantDigits < 1 || significantDigits > 100) {
    throw new RangeError('significantDigits must be between 1 and 100');
  }
  if (value === 0n) {
    return '0';
  }

  const sign = value < 0n ? '-' : '';
  const absoluteDigits = (value < 0n ? -value : value).toString();
  let exponent = absoluteDigits.length - 1;
  let roundedDigits;

  if (absoluteDigits.length <= significantDigits) {
    roundedDigits = absoluteDigits.padEnd(significantDigits, '0');
  } else {
    roundedDigits = absoluteDigits.slice(0, significantDigits);
    if (absoluteDigits.charCodeAt(significantDigits) >= 53) {
      roundedDigits = (BigInt(roundedDigits) + 1n).toString();
      if (roundedDigits.length > significantDigits) {
        exponent += 1;
        roundedDigits = `1${'0'.repeat(significantDigits - 1)}`;
      }
    }
  }

  const fractionalDigits = roundedDigits.slice(1);
  const coefficient = fractionalDigits
    ? `${roundedDigits[0]}.${fractionalDigits}`
    : roundedDigits[0];
  const exponentSign = exponent >= 0 ? '+' : '';
  return `${sign}${coefficient}e${exponentSign}${exponent}`;
}
