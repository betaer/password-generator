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

const GENERATION_RESULT_TYPE_SET = new Set(GENERATION_RESULT_TYPES);
const RESULT_BRAND = Symbol('PasswordGeneratorV2.GenerationResult');
const ENTROPY_FIELDS = Object.freeze([
  'sourceEntropyBits',
  'minEntropyBits',
  'shannonEntropyBits',
  'averageGuessBits',
]);
let resultSequence = 0;

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isPlainObject(value) {
  if (!isObject(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function cloneMetadata(value, seen = new Map()) {
  if (value === null || ['string', 'boolean', 'undefined', 'bigint'].includes(typeof value)) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError('metadata numbers must be finite');
    }
    return value;
  }
  if (!isObject(value)) {
    throw new TypeError('metadata must contain only immutable data values');
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new TypeError('mutable binary data must use the result bytes field');
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError('metadata must contain only arrays and plain objects');
  }
  if (seen.has(value)) {
    return seen.get(value);
  }

  const clone = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    clone[key] = cloneMetadata(value[key], seen);
  }
  return clone;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!isObject(value) || seen.has(value)) {
    return value;
  }
  // Non-empty typed arrays cannot be frozen in JavaScript. Result bytes remain
  // intentionally mutable so clearGenerationResult can overwrite them.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return value;
  }

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function validateGenerationModel(generationModel) {
  if (!isPlainObject(generationModel)) {
    throw new TypeError('generationModel must be a plain object');
  }
  if (typeof generationModel.searchSpace !== 'bigint') {
    throw new TypeError('generationModel.searchSpace must be a BigInt');
  }
  if (generationModel.searchSpace <= 0n) {
    throw new RangeError('generationModel.searchSpace must be positive');
  }

  for (const field of ENTROPY_FIELDS) {
    if (!(field in generationModel)) {
      continue;
    }
    if (typeof generationModel[field] !== 'number') {
      throw new TypeError(`generationModel.${field} must be a number`);
    }
    if (!Number.isFinite(generationModel[field]) || generationModel[field] < 0) {
      throw new RangeError(`generationModel.${field} must be finite and non-negative`);
    }
  }
}

function createResultId(type, createdAt) {
  resultSequence += 1;
  return `v2:${type}:${createdAt.toString(36)}:${resultSequence.toString(36)}`;
}

export function createGenerationResult({
  id,
  type,
  schemeId,
  value,
  bytes,
  configSnapshot,
  generationModel,
  createdAt,
} = {}) {
  requireNonEmptyString(type, 'type');
  if (!GENERATION_RESULT_TYPE_SET.has(type)) {
    throw new RangeError(`unsupported generation result type: ${type}`);
  }
  requireNonEmptyString(schemeId, 'schemeId');
  if (typeof value !== 'string') {
    throw new TypeError('value must be a string');
  }
  if (bytes !== undefined && !(bytes instanceof Uint8Array)) {
    throw new TypeError('bytes must be a Uint8Array when provided');
  }
  if (!isPlainObject(configSnapshot)) {
    throw new TypeError('configSnapshot must be a plain object');
  }
  validateGenerationModel(generationModel);

  const normalizedCreatedAt = createdAt === undefined ? Date.now() : createdAt;
  if (typeof normalizedCreatedAt !== 'number') {
    throw new TypeError('createdAt must be a number');
  }
  if (!Number.isSafeInteger(normalizedCreatedAt) || normalizedCreatedAt < 0) {
    throw new RangeError('createdAt must be a non-negative safe integer');
  }

  if (id !== undefined) {
    requireNonEmptyString(id, 'id');
  }
  const normalizedId = id === undefined
    ? createResultId(type, normalizedCreatedAt)
    : id;
  const immutableConfig = deepFreeze(cloneMetadata(configSnapshot));
  const immutableModel = deepFreeze(cloneMetadata(generationModel));

  return deepFreeze({
    [RESULT_BRAND]: true,
    id: normalizedId,
    type,
    schemeId,
    value,
    bytes: bytes ?? null,
    createdAt: normalizedCreatedAt,
    configSnapshot: immutableConfig,
    generationModel: immutableModel,
  });
}

/**
 * Overwrites mutable byte storage and returns null so callers can release their
 * result reference with `result = clearGenerationResult(result)`.
 */
export function clearGenerationResult(result) {
  if (!isObject(result) || result[RESULT_BRAND] !== true) {
    throw new TypeError('result must be a GenerationResult');
  }
  if (result.bytes instanceof Uint8Array) {
    result.bytes.fill(0);
  }
  return null;
}
