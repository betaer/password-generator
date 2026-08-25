import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearGenerationResult,
  createGenerationResult,
  V201_SCHEMA_VERSION,
} from '../../src/v201/result-model.mjs';
import { createPowerOfTwoSearchSpace } from '../../src/v201/probability-contract.mjs';

function validInput(overrides = {}) {
  return {
    type: 'random-bytes',
    schemeId: 'raw-random-bytes',
    value: '',
    bytes: Uint8Array.of(1, 2, 3),
    configSnapshot: { byteLength: 3 },
    generationModel: {
      searchSpace: createPowerOfTwoSearchSpace(24),
      generatorMinEntropyBits: 24,
      generatorShannonEntropyBits: 24,
      nominalCsprngOutputBits: 24,
      randomSourceBytesRequested: 3,
      randomSourceConsumptionModel: 'fixed-byte-request',
      presentationProfile: 'random-bytes',
    },
    ...overrides,
  };
}

test('V2.0.1 结果携带不可变概率契约和精确期望次序', () => {
  const input = validInput();
  const result = createGenerationResult(input);

  assert.equal(result.schemaVersion, V201_SCHEMA_VERSION);
  assert.equal(result.generationModel.expectedRank.numerator, 16_777_217n);
  assert.equal(result.generationModel.expectedRank.denominator, 2n);
  assert.equal(Object.isFrozen(result.generationModel), true);
  assert.notEqual(result.configSnapshot, input.configSnapshot);
});

test('V2.0.1 拒绝含混的 sourceEntropyBits 与旧平均猜测字段', () => {
  assert.throws(() => createGenerationResult(validInput({
    generationModel: {
      ...validInput().generationModel,
      sourceEntropyBits: 24,
    },
  })), /sourceEntropyBits/u);
  assert.throws(() => createGenerationResult(validInput({
    generationModel: {
      ...validInput().generationModel,
      averageGuessBits: 23,
    },
  })), /averageGuessBits/u);
});

test('清除结果会覆写全部可控字节', () => {
  const bytes = Uint8Array.of(9, 8, 7);
  const result = createGenerationResult(validInput({ bytes }));
  assert.equal(clearGenerationResult(result), null);
  assert.deepEqual([...bytes], [0, 0, 0]);
});

