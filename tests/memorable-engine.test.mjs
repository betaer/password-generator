import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const memorableEngine = require('../assets/js/memorable-engine.js');
const {
  secureRandomIndex,
  SecureWordGenerator,
  EntropyCalculator,
} = memorableEngine;

function deterministicCrypto(values = [0]) {
  let cursor = 0;
  return {
    getRandomValues(buffer) {
      buffer[0] = values[cursor % values.length] >>> 0;
      cursor += 1;
      return buffer;
    },
  };
}

test('secureRandomIndex 校验范围并使用注入的 Web Crypto', () => {
  assert.throws(() => secureRandomIndex(0, deterministicCrypto()), RangeError);
  assert.throws(() => secureRandomIndex(0x100000001, deterministicCrypto()), RangeError);
  assert.equal(secureRandomIndex(10, deterministicCrypto([19])), 9);
});

test('SecureWordGenerator 只接受词包和随机源，不接收故事描述', () => {
  const entries = ['lantern', 'velvet', 'orbit', 'rabbit'].map((word, id) => ({ id, word }));
  const generatorA = new SecureWordGenerator(deterministicCrypto([0, 1, 2, 3]));
  const generatorB = new SecureWordGenerator(deterministicCrypto([0, 1, 2, 3]));
  assert.deepEqual(generatorA.generate(entries, 4), generatorB.generate(entries, 4));
  assert.deepEqual(generatorA.generate.length, 2);
});

test('熵只按实际词池和词数计算', () => {
  const entropy = EntropyCalculator.forWords(7776, 12);
  assert.equal(entropy.contextBits, 0);
  assert.ok(Math.abs(entropy.bitsPerWord - Math.log2(7776)) < 1e-10);
  assert.ok(Math.abs(entropy.totalBits - 12 * Math.log2(7776)) < 1e-10);
});

test('本地引擎只保留安全随机词与熵计算，不再导出记忆故事能力', () => {
  assert.equal(memorableEngine.StoryIntentParser, undefined);
  assert.equal(memorableEngine.StoryRenderer, undefined);
  assert.equal(memorableEngine.STORY_GRAMMAR_STATS, undefined);
});
