import { formatExistingBytes } from '../v2/byte-secret-models.mjs';
import { secureRandomBytes } from '../v2/random-core.mjs';
import { createPowerOfTwoSearchSpace } from './probability-contract.mjs';
import { createGenerationResult } from './result-model.mjs';

const MAX_RANDOM_BYTES = 1024 * 1024;
const PREVIEW_BYTES = 24;
const ENCODINGS = new Set(['hex', 'base64', 'base64url', 'base64url-nopad']);

function toHex(bytes) {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('config must be an object');
  const byteLength = config.byteLength ?? 64;
  const encoding = config.encoding ?? 'hex';
  const uppercase = config.uppercase ?? false;
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_RANDOM_BYTES) {
    throw new RangeError('byteLength must be between 1 and 1048576');
  }
  if (!ENCODINGS.has(encoding)) throw new RangeError(`unsupported encoding: ${String(encoding)}`);
  if (typeof uppercase !== 'boolean') throw new TypeError('uppercase must be a boolean');
  return Object.freeze({ byteLength, encoding, uppercase });
}

async function sha256(bytes, cryptoLike) {
  if (!cryptoLike?.subtle || typeof cryptoLike.subtle.digest !== 'function') {
    throw new TypeError('Web Crypto subtle.digest is required');
  }
  return toHex(new Uint8Array(await cryptoLike.subtle.digest('SHA-256', bytes)));
}

export async function generateLazyRandomBytes(config = {}, cryptoLike = globalThis.crypto) {
  const normalized = normalizeConfig(config);
  const bytes = secureRandomBytes(normalized.byteLength, cryptoLike);
  let digest;
  try {
    digest = await sha256(bytes, cryptoLike);
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
  const previewBytes = bytes.subarray(0, Math.min(bytes.length, PREVIEW_BYTES));
  const previewEncoding = normalized.encoding === 'base64url' ? 'base64url-nopad' : normalized.encoding;
  const preview = `${formatExistingBytes(previewBytes, previewEncoding, { uppercase: normalized.uppercase })}${
    bytes.length > PREVIEW_BYTES ? '…' : ''
  }`;
  const bits = normalized.byteLength * 8;
  const result = createGenerationResult({
    type: 'random-bytes',
    schemeId: 'raw-random-bytes-v201',
    value: '',
    bytes,
    configSnapshot: {
      ...normalized,
      lazyEncoding: true,
      previewByteLength: previewBytes.byteLength,
    },
    generationModel: {
      searchSpace: createPowerOfTwoSearchSpace(bits),
      generatorMinEntropyBits: bits,
      generatorShannonEntropyBits: bits,
      nominalCsprngOutputBits: bits,
      randomSourceBytesRequested: normalized.byteLength,
      randomSourceConsumptionModel: 'fixed-byte-request',
      presentationProfile: 'random-bytes',
      encoding: normalized.encoding,
      standard: 'Web Crypto getRandomValues',
    },
  });
  return Object.freeze({ ...result, preview, sha256: digest });
}

export function materializeRandomBytes(result, encoding = result?.configSnapshot?.encoding) {
  if (!result || result.type !== 'random-bytes' || !(result.bytes instanceof Uint8Array)) {
    throw new TypeError('result must be a Random Bytes result');
  }
  if (!ENCODINGS.has(encoding)) throw new RangeError(`unsupported encoding: ${String(encoding)}`);
  return formatExistingBytes(result.bytes, encoding, { uppercase: result.configSnapshot.uppercase });
}

