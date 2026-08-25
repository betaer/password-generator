import { secureRandomBytes } from './random-core.mjs';
import { createGenerationResult } from './result-model.mjs';
import { encodeHex } from './encoders.mjs';

const MAX_UUID_V7_TIMESTAMP = (2 ** 48) - 1;

function normalizeConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  const hyphens = config.hyphens === undefined ? true : config.hyphens;
  const uppercase = config.uppercase === undefined ? false : config.uppercase;
  if (typeof hyphens !== 'boolean') {
    throw new TypeError('hyphens must be a boolean');
  }
  if (typeof uppercase !== 'boolean') {
    throw new TypeError('uppercase must be a boolean');
  }
  return { hyphens, uppercase };
}

function formatUuid(bytes, { hyphens, uppercase }) {
  const encoded = encodeHex(bytes, uppercase);
  if (!hyphens) return encoded;
  return [
    encoded.slice(0, 8),
    encoded.slice(8, 12),
    encoded.slice(12, 16),
    encoded.slice(16, 20),
    encoded.slice(20),
  ].join('-');
}

function uuidGenerationModel({ version, entropyBits, timestampUnixMs = null }) {
  const standard = `RFC 9562 UUIDv${version}`;
  return {
    sourceEntropyBits: entropyBits,
    minEntropyBits: entropyBits,
    shannonEntropyBits: entropyBits,
    searchSpace: 1n << BigInt(entropyBits),
    averageGuessBits: entropyBits - 1,
    alphabet: '0123456789abcdef',
    poolSizes: { randomBit: 2 },
    randomByteLength: version === 4 ? 16 : 10,
    encoding: 'uuid',
    prefix: '',
    checksumBits: 0,
    standard,
    version,
    variant: '10',
    randomBits: entropyBits,
    timestampBits: version === 7 ? 48 : 0,
    timestampUnixMs,
    deterministicFormatBits: 128 - entropyBits,
  };
}

export function generateUuidV4(config = {}, cryptoLike = globalThis.crypto) {
  const normalizedConfig = normalizeConfig(config);
  const bytes = secureRandomBytes(16, cryptoLike);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return createGenerationResult({
    type: 'uuid',
    schemeId: 'uuid-v4',
    value: formatUuid(bytes, normalizedConfig),
    bytes,
    configSnapshot: normalizedConfig,
    generationModel: uuidGenerationModel({ version: 4, entropyBits: 122 }),
  });
}

export function generateUuidV7(
  config = {},
  cryptoLike = globalThis.crypto,
  now = Date.now,
) {
  const normalizedConfig = normalizeConfig(config);
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }
  const timestampUnixMs = now();
  if (!Number.isSafeInteger(timestampUnixMs)
    || timestampUnixMs < 0
    || timestampUnixMs > MAX_UUID_V7_TIMESTAMP) {
    throw new RangeError('UUID v7 timestamp must be an integer in the unsigned 48-bit range');
  }

  const random = secureRandomBytes(10, cryptoLike);
  const bytes = new Uint8Array(16);
  let timestamp = timestampUnixMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }

  bytes[6] = 0x70 | (random[0] & 0x0f);
  bytes[7] = random[1];
  bytes[8] = 0x80 | (random[2] & 0x3f);
  bytes.set(random.subarray(3), 9);
  random.fill(0);

  return createGenerationResult({
    type: 'uuid',
    schemeId: 'uuid-v7',
    value: formatUuid(bytes, normalizedConfig),
    bytes,
    configSnapshot: { ...normalizedConfig, timestampUnixMs },
    generationModel: uuidGenerationModel({
      version: 7,
      entropyBits: 74,
      timestampUnixMs,
    }),
  });
}

