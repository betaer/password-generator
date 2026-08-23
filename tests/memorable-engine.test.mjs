import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  secureRandomIndex,
  SecureWordGenerator,
  StoryIntentParser,
  StoryRenderer,
  EntropyCalculator,
  STORY_GRAMMAR_STATS,
} = require('../assets/js/memorable-engine.js');

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

test('十二个核心词按原顺序拆成三幕且每词只在故事正文出现一次', () => {
  const words = ['lantern', 'velvet', 'orbit', 'rabbit', 'kernel', 'island', 'copper', 'window', 'forest', 'rocket', 'signal', 'harbor'];
  const intent = StoryIntentParser.parse('一个宇航员在火星上修理服务器');
  const story = StoryRenderer.render(words, intent);
  assert.equal(story.scenes.length, 3);
  assert.deepEqual(story.scenes.flatMap(scene => scene.words), words);
  const text = story.scenes.map(scene => scene.sentence).join(' ');
  for (const word of words) {
    assert.equal(text.match(new RegExp(`\\b${word}\\b`, 'g'))?.length, 1, word);
  }
});

test('同一条记忆短语的三幕使用不同故事骨架', () => {
  const words = ['laptop', 'breath', 'deafening', 'anchor', 'setting', 'rented', 'mystified', 'endorphin', 'cornhusk', 'grimace', 'urethane', 'boat'];
  const story = StoryRenderer.render(words, StoryIntentParser.parse('一个宇航员在火星上修理服务器'));
  const signatures = story.scenes.map(scene => scene.parts
    .filter(part => part.type === 'text')
    .map(part => part.value)
    .join('|'));
  assert.equal(new Set(signatures).size, 3);
});

test('故事描述不计入熵，熵只按实际词池和词数计算', () => {
  const a = EntropyCalculator.forWords(7776, 12, { storyContext: '' });
  const b = EntropyCalculator.forWords(7776, 12, { storyContext: '我的私人火星经历' });
  assert.equal(a.totalBits, b.totalBits);
  assert.equal(a.contextBits, 0);
  assert.ok(Math.abs(a.bitsPerWord - Math.log2(7776)) < 1e-10);
  assert.ok(Math.abs(a.totalBits - 12 * Math.log2(7776)) < 1e-10);
});

test('组合式故事语法提供六个主题、每主题至少二十个骨架和两百个以上微型组合', () => {
  assert.equal(STORY_GRAMMAR_STATS.themeCount, 6);
  assert.ok(STORY_GRAMMAR_STATS.skeletonsPerTheme >= 20);
  assert.ok(STORY_GRAMMAR_STATS.microCombinationsPerTheme >= 200);
});
