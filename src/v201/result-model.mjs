import {
  expectedRankForSearchSpace,
  normalizeSearchSpace,
} from './probability-contract.mjs';

export const V201_SCHEMA_VERSION = '2.0.1';
export const GENERATION_RESULT_TYPES = Object.freeze([
  'password',
  'passphrase',
  'pin',
  'token',
  'api-secret',
  'uuid',
  'hex',
  'random-bytes',
  'mnemonic',
]);

const TYPE_SET = new Set(GENERATION_RESULT_TYPES);
const RESULT_BRAND = Symbol('PasswordGeneratorV201.GenerationResult');
let sequence = 0;

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneMetadata(value, seen = new Map()) {
  if (value === null || ['string', 'boolean', 'undefined', 'bigint'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('metadata numbers must be finite');
    return value;
  }
  if (!value || typeof value !== 'object') throw new TypeError('metadata contains an unsupported value');
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new TypeError('mutable binary data must use the result bytes field');
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError('metadata must contain arrays and plain objects only');
  }
  if (seen.has(value)) return seen.get(value);
  const clone = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) clone[key] = cloneMetadata(value[key], seen);
  return clone;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function requireString(value, name, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new TypeError(`${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
}

function validateGenerationModel(input) {
  if (!isPlainObject(input)) throw new TypeError('generationModel must be a plain object');
  if ('sourceEntropyBits' in input) {
    throw new TypeError('sourceEntropyBits is ambiguous; use nominalCsprngOutputBits');
  }
  if ('averageGuessBits' in input) {
    throw new TypeError('averageGuessBits is obsolete; expectedRank is derived exactly');
  }
  const searchSpace = normalizeSearchSpace(input.searchSpace);
  const numericFields = [
    'generatorMinEntropyBits',
    'generatorShannonEntropyBits',
    'nominalCsprngOutputBits',
    'randomSourceBytesRequested',
  ];
  for (const field of numericFields) {
    if (!(field in input)) continue;
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] < 0) {
      throw new RangeError(`generationModel.${field} must be a non-negative finite number`);
    }
  }
  requireString(input.presentationProfile, 'generationModel.presentationProfile');
  return {
    ...cloneMetadata(input),
    schemaVersion: V201_SCHEMA_VERSION,
    searchSpace,
    expectedRank: expectedRankForSearchSpace(searchSpace),
  };
}

export function createGenerationResult({
  id,
  type,
  schemeId,
  value,
  bytes,
  configSnapshot,
  generationModel,
  createdAt = Date.now(),
} = {}) {
  requireString(type, 'type');
  if (!TYPE_SET.has(type)) throw new RangeError(`unsupported generation result type: ${type}`);
  requireString(schemeId, 'schemeId');
  requireString(value, 'value', true);
  if (bytes !== undefined && !(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
  if (!isPlainObject(configSnapshot)) throw new TypeError('configSnapshot must be a plain object');
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new RangeError('createdAt must be a non-negative safe integer');
  if (id !== undefined) requireString(id, 'id');

  sequence += 1;
  return deepFreeze({
    [RESULT_BRAND]: true,
    id: id ?? `v201:${type}:${createdAt.toString(36)}:${sequence.toString(36)}`,
    schemaVersion: V201_SCHEMA_VERSION,
    type,
    schemeId,
    value,
    bytes: bytes ?? null,
    createdAt,
    configSnapshot: deepFreeze(cloneMetadata(configSnapshot)),
    generationModel: deepFreeze(validateGenerationModel(generationModel)),
  });
}

export function clearGenerationResult(result, seen = new WeakSet()) {
  if (!result || typeof result !== 'object' || result[RESULT_BRAND] !== true) {
    throw new TypeError('result must be a V2.0.1 GenerationResult');
  }
  if (seen.has(result)) return null;
  seen.add(result);
  if (result.bytes instanceof Uint8Array) result.bytes.fill(0);
  for (const child of Object.values(result)) {
    if (child && typeof child === 'object' && child[RESULT_BRAND] === true) {
      clearGenerationResult(child, seen);
    }
  }
  return null;
}

