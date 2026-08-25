import { secureRandomBytes } from './random-core.mjs';
import { createGenerationResult } from './result-model.mjs';
import {
  encodeBase64,
  encodeBase64Url,
  encodeHex,
} from './encoders.mjs';

const SECRET_BYTE_LIMIT = 4096;
const RANDOM_BYTES_LIMIT = 1_048_576;
const ENCODINGS = new Set(['hex', 'base64', 'base64url', 'base64url-nopad']);
const ALPHABETS = Object.freeze({
  hex: '0123456789abcdef',
  base64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  base64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  'base64url-nopad': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
});

function normalizeByteLength(value, maximum, defaultValue = 32) {
  const byteLength = value === undefined ? defaultValue : value;
  if (!Number.isSafeInteger(byteLength)) {
    throw new TypeError('byteLength must be a safe integer');
  }
  if (byteLength < 1 || byteLength > maximum) {
    throw new RangeError(`byteLength must be between 1 and ${maximum}`);
  }
  return byteLength;
}

function normalizeEncoding(value, defaultValue = 'base64url-nopad') {
  const encoding = value === undefined ? defaultValue : value;
  if (typeof encoding !== 'string') {
    throw new TypeError('encoding must be a string');
  }
  if (!ENCODINGS.has(encoding)) {
    throw new RangeError(`unsupported encoding: ${encoding}`);
  }
  return encoding;
}

function normalizePrefix(value, fieldName = 'prefix') {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string`);
  }
  return value;
}

function normalizeBoolean(value, defaultValue, fieldName) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new TypeError(`${fieldName} must be a boolean`);
  }
  return value;
}

function composeApiPrefix(config) {
  const fixedPrefix = normalizePrefix(config.prefix);
  const separator = config.fieldSeparator === undefined
    ? '_'
    : normalizePrefix(config.fieldSeparator, 'fieldSeparator');
  const fields = [];
  for (const [name, value] of [['environment', config.environment], ['version', config.version]]) {
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') {
      throw new TypeError(`${name} must be a string`);
    }
    fields.push(value);
  }
  return fields.length === 0
    ? fixedPrefix
    : `${fixedPrefix}${fields.join(separator)}${separator}`;
}

function modelForBytes({ byteLength, encoding, prefix, standard, uppercase = false }) {
  const entropyBits = byteLength * 8;
  return {
    sourceEntropyBits: entropyBits,
    minEntropyBits: entropyBits,
    shannonEntropyBits: entropyBits,
    searchSpace: 1n << BigInt(entropyBits),
    averageGuessBits: Math.max(0, entropyBits - 1),
    alphabet: encoding === 'hex' && uppercase
      ? ALPHABETS.hex.toUpperCase()
      : ALPHABETS[encoding],
    poolSizes: { byte: 256 },
    randomByteLength: byteLength,
    encoding,
    prefix,
    checksumBits: 0,
    standard,
  };
}

function generateByteResult({
  type,
  schemeId,
  byteLength,
  encoding,
  prefix,
  uppercase = false,
  maximum = SECRET_BYTE_LIMIT,
  standard,
  configSnapshot,
  cryptoLike,
}) {
  const normalizedLength = normalizeByteLength(byteLength, maximum);
  const normalizedEncoding = normalizeEncoding(encoding);
  const normalizedPrefix = normalizePrefix(prefix);
  const bytes = secureRandomBytes(normalizedLength, cryptoLike);
  const encoded = formatExistingBytes(bytes, normalizedEncoding, { uppercase });
  return createGenerationResult({
    type,
    schemeId,
    value: normalizedPrefix + encoded,
    bytes,
    configSnapshot: {
      ...configSnapshot,
      byteLength: normalizedLength,
      encoding: normalizedEncoding,
      prefix: normalizedPrefix,
      uppercase,
    },
    generationModel: modelForBytes({
      byteLength: normalizedLength,
      encoding: normalizedEncoding,
      prefix: normalizedPrefix,
      standard,
      uppercase,
    }),
  });
}

export function formatExistingBytes(bytes, encoding, options = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytes must be a Uint8Array');
  }
  const normalizedEncoding = normalizeEncoding(encoding);
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  switch (normalizedEncoding) {
    case 'hex':
      return encodeHex(bytes, normalizeBoolean(options.uppercase, false, 'uppercase'));
    case 'base64':
      return encodeBase64(bytes);
    case 'base64url':
      return encodeBase64Url(bytes, true);
    case 'base64url-nopad':
      return encodeBase64Url(bytes, false);
    default:
      throw new RangeError(`unsupported encoding: ${normalizedEncoding}`);
  }
}

export function generateToken(config = {}, cryptoLike = globalThis.crypto) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  return generateByteResult({
    type: 'token',
    schemeId: 'random-byte-token',
    byteLength: config.byteLength,
    encoding: config.encoding,
    prefix: config.prefix,
    maximum: SECRET_BYTE_LIMIT,
    standard: 'Web Crypto random token',
    configSnapshot: {},
    cryptoLike,
  });
}

export function generateApiSecret(config = {}, cryptoLike = globalThis.crypto) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  const prefix = composeApiPrefix(config);
  let keyId = null;
  if (config.keyId !== undefined && config.keyId !== false) {
    if (config.keyId === null || typeof config.keyId !== 'object' || Array.isArray(config.keyId)) {
      throw new TypeError('keyId must be an object or false');
    }
    keyId = generateByteResult({
      type: 'api-secret',
      schemeId: 'api-key-id',
      byteLength: config.keyId.byteLength,
      encoding: config.keyId.encoding ?? 'base64url-nopad',
      prefix: config.keyId.prefix,
      uppercase: config.keyId.uppercase,
      maximum: SECRET_BYTE_LIMIT,
      standard: 'Independent random API key identifier',
      configSnapshot: { fieldRole: 'key-id' },
      cryptoLike,
    });
  }

  const secret = generateByteResult({
    type: 'api-secret',
    schemeId: config.template ? `api-secret-${config.template}` : 'generic-api-secret',
    byteLength: config.byteLength,
    encoding: config.encoding,
    prefix,
    uppercase: config.uppercase,
    maximum: SECRET_BYTE_LIMIT,
    standard: config.template
      ? 'Test-only API secret appearance template'
      : 'Generic Web Crypto API secret',
    configSnapshot: {
      environment: config.environment ?? '',
      version: config.version ?? '',
      fieldSeparator: config.fieldSeparator ?? '_',
      template: config.template ?? null,
      testOnlyAppearance: Boolean(config.template),
      keyId: keyId
        ? {
          byteLength: keyId.generationModel.randomByteLength,
          encoding: keyId.generationModel.encoding,
          prefix: keyId.generationModel.prefix,
        }
        : null,
    },
    cryptoLike,
  });

  if (!keyId) return secret;
  return Object.freeze({
    ...secret,
    keyId,
    fields: Object.freeze({ keyId: keyId.value, secret: secret.value }),
  });
}

export function generateHex(config = {}, cryptoLike = globalThis.crypto) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  const uppercase = normalizeBoolean(config.uppercase, false, 'uppercase');
  const includePrefix = config.prefix === '0x'
    || normalizeBoolean(config.prefix, false, 'prefix');
  return generateByteResult({
    type: 'hex',
    schemeId: config.schemeId ?? 'random-hex',
    byteLength: config.byteLength,
    encoding: 'hex',
    prefix: includePrefix ? '0x' : '',
    uppercase,
    maximum: SECRET_BYTE_LIMIT,
    standard: config.schemeId === 'wallet-private-key-appearance'
      ? 'Test-only wallet private-key appearance'
      : 'Hex-encoded Web Crypto random bytes',
    configSnapshot: {
      testOnlyAppearance: config.schemeId === 'wallet-private-key-appearance',
    },
    cryptoLike,
  });
}

export function generateRandomBytes(config = {}, cryptoLike = globalThis.crypto) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  return generateByteResult({
    type: 'random-bytes',
    schemeId: 'raw-random-bytes',
    byteLength: config.byteLength,
    encoding: config.encoding ?? 'hex',
    prefix: '',
    uppercase: config.uppercase,
    maximum: RANDOM_BYTES_LIMIT,
    standard: 'Web Crypto random bytes',
    configSnapshot: {},
    cryptoLike,
  });
}

export function createBinaryDownload(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytes must be a Uint8Array');
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const BlobConstructor = options.BlobConstructor ?? globalThis.Blob;
  const urlApi = options.urlApi ?? globalThis.URL;
  if (typeof BlobConstructor !== 'function') {
    throw new Error('Blob is unavailable in this runtime');
  }
  if (!urlApi || typeof urlApi.createObjectURL !== 'function' || typeof urlApi.revokeObjectURL !== 'function') {
    throw new TypeError('urlApi must provide createObjectURL and revokeObjectURL');
  }
  const mimeType = options.mimeType ?? 'application/octet-stream';
  if (typeof mimeType !== 'string') {
    throw new TypeError('mimeType must be a string');
  }

  const blob = new BlobConstructor([bytes], { type: mimeType });
  const url = urlApi.createObjectURL(blob);
  let revoked = false;
  return Object.freeze({
    blob,
    url,
    revoke() {
      if (revoked) return;
      revoked = true;
      urlApi.revokeObjectURL(url);
    },
  });
}
