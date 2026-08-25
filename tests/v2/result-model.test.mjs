import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearGenerationResult,
  createGenerationResult,
  deepFreeze,
  GENERATION_RESULT_TYPES,
} from '../../src/v2/result-model.mjs';

function validResult(overrides = {}) {
  return {
    id: 'result-1',
    type: 'token',
    schemeId: 'base64url-256',
    value: 'secret-value',
    bytes: Uint8Array.of(1, 2, 3),
    createdAt: 1_700_000_000_000,
    configSnapshot: {
      byteLength: 3,
      formatting: { encoding: 'base64url', padding: false },
    },
    generationModel: {
      sourceEntropyBits: 24,
      minEntropyBits: 24,
      shannonEntropyBits: 24,
      searchSpace: 1n << 24n,
      averageGuessBits: 23,
      poolSizes: [256, 256, 256],
    },
    ...overrides,
  };
}

test('createGenerationResult deep-clones and freezes nested metadata', () => {
  const input = validResult();
  const result = createGenerationResult(input);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.configSnapshot), true);
  assert.equal(Object.isFrozen(result.configSnapshot.formatting), true);
  assert.equal(Object.isFrozen(result.generationModel), true);
  assert.equal(Object.isFrozen(result.generationModel.poolSizes), true);
  assert.notEqual(result.configSnapshot, input.configSnapshot);

  assert.throws(() => {
    result.configSnapshot.formatting.encoding = 'hex';
  }, TypeError);
});

test('metadata remains unchanged when the caller mutates its original objects', () => {
  const input = validResult();
  const result = createGenerationResult(input);

  input.configSnapshot.formatting.encoding = 'hex';
  input.generationModel.poolSizes[0] = 1;

  assert.equal(result.configSnapshot.formatting.encoding, 'base64url');
  assert.equal(result.generationModel.poolSizes[0], 256);
});

test('omitted identifiers use unique monotonic IDs without consuming generator randomness', () => {
  const first = createGenerationResult(validResult({ id: undefined, createdAt: 123 }));
  const second = createGenerationResult(validResult({ id: undefined, createdAt: 123 }));

  assert.match(first.id, /^v2:token:3f:/);
  assert.notEqual(first.id, second.id);
});

test('clearGenerationResult zeroes owned mutable bytes and returns null for reference release', () => {
  const bytes = Uint8Array.of(9, 8, 7);
  const result = createGenerationResult(validResult({ bytes }));

  assert.equal(clearGenerationResult(result), null);
  assert.deepEqual([...bytes], [0, 0, 0]);
});

test('clearGenerationResult safely accepts results without byte storage', () => {
  const result = createGenerationResult(validResult({ bytes: undefined }));
  assert.equal(clearGenerationResult(result), null);
  assert.throws(() => clearGenerationResult({ bytes: Uint8Array.of(1) }), TypeError);
});

test('deepFreeze handles repeated references and cycles', () => {
  const shared = { enabled: true };
  const value = { first: shared, second: shared };
  value.self = value;

  const frozen = deepFreeze(value);

  assert.equal(frozen, value);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(shared), true);
});

test('the public result type registry is complete, unique, and immutable', () => {
  assert.deepEqual(GENERATION_RESULT_TYPES, [
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
  assert.equal(new Set(GENERATION_RESULT_TYPES).size, GENERATION_RESULT_TYPES.length);
  assert.equal(Object.isFrozen(GENERATION_RESULT_TYPES), true);
});

test('createGenerationResult rejects invalid identifiers, types, values, bytes, and timestamps', () => {
  assert.throws(() => createGenerationResult(validResult({ id: '' })), TypeError);
  assert.throws(() => createGenerationResult(validResult({ type: ['token', 'token'] })), TypeError);
  assert.throws(() => createGenerationResult(validResult({ type: 'unknown' })), RangeError);
  assert.throws(() => createGenerationResult(validResult({ schemeId: '  ' })), TypeError);
  assert.throws(() => createGenerationResult(validResult({ value: null })), TypeError);
  assert.throws(() => createGenerationResult(validResult({ bytes: [1, 2, 3] })), TypeError);
  assert.throws(() => createGenerationResult(validResult({ createdAt: 'today' })), TypeError);
  assert.throws(() => createGenerationResult(validResult({ createdAt: Number.NaN })), RangeError);
  assert.throws(() => createGenerationResult(validResult({ createdAt: 1.5 })), RangeError);
});

test('createGenerationResult rejects mutable exotic metadata', () => {
  assert.throws(
    () => createGenerationResult(validResult({ configSnapshot: new Map([['secret', true]]) })),
    TypeError,
  );
  assert.throws(
    () => createGenerationResult(validResult({ generationModel: { searchSpace: 2n, bytes: Uint8Array.of(1) } })),
    TypeError,
  );
});

test('createGenerationResult rejects invalid search spaces and entropy fields', () => {
  assert.throws(
    () => createGenerationResult(validResult({ generationModel: { searchSpace: 0n, minEntropyBits: 0 } })),
    RangeError,
  );
  assert.throws(
    () => createGenerationResult(validResult({ generationModel: { searchSpace: 2n, minEntropyBits: Infinity } })),
    RangeError,
  );
  assert.throws(
    () => createGenerationResult(validResult({ generationModel: { searchSpace: 2n, minEntropyBits: -1 } })),
    RangeError,
  );
  assert.throws(
    () => createGenerationResult(validResult({ generationModel: { searchSpace: 2n, minEntropyBits: '1' } })),
    TypeError,
  );
});
