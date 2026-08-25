function requireSha256(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError('expected SHA-256 must be 64 lowercase hex characters');
  }
  return value;
}

function bytesToHex(bytes) {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

export async function sha256Text(value, cryptoLike = globalThis.crypto) {
  if (typeof value !== 'string') throw new TypeError('SHA-256 input must be a string');
  if (!cryptoLike?.subtle || typeof cryptoLike.subtle.digest !== 'function') {
    throw new TypeError('Web Crypto subtle.digest is required for asset integrity');
  }
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await cryptoLike.subtle.digest('SHA-256', bytes)));
}

export async function verifyWordArraySha256(words, expectedSha256, cryptoLike = globalThis.crypto) {
  if (!Array.isArray(words) || words.some((word) => typeof word !== 'string')) {
    throw new TypeError('word asset must be a string array');
  }
  const expected = requireSha256(expectedSha256);
  const actual = await sha256Text(words.join('\n'), cryptoLike);
  if (actual !== expected) throw new Error(`词表 SHA-256 验证失败：expected ${expected}, actual ${actual}`);
  return actual;
}

