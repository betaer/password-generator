import { secureInt } from './random-core.mjs';
import { log2BigInt } from './combinatorics.mjs';
import {
  createGenerationResult,
  deepFreeze,
} from './result-model.mjs';

const CAPITALIZATION_MODES = new Set([
  'lowercase',
  'first-word',
  'every-word',
  'random-uppercase',
]);

const FIXED_SEPARATORS = Object.freeze({
  hyphen: '-',
  underscore: '_',
  period: '.',
  space: ' ',
});

const SEPARATOR_MODES = new Set([
  ...Object.keys(FIXED_SEPARATORS),
  'random-digit',
  'random-symbol',
]);

const DIGIT_SEPARATORS = Object.freeze([...'0123456789']);
const MAX_WORD_COUNT = 100;

function uniqueCharacters(value) {
  const source = Array.isArray(value) ? value : [...String(value ?? '')];
  return [...new Set(source)];
}

function normalizeWords(words) {
  if (!Array.isArray(words) || words.length === 0) {
    throw new TypeError('words 必须是非空单词数组');
  }

  const normalized = words.map((word, index) => {
    if (typeof word !== 'string' || word.length === 0 || word.trim() !== word) {
      throw new TypeError(`words[${index}] 必须是不含首尾空白的非空字符串`);
    }
    const lowercase = word.toLowerCase();
    if (!lowercase) {
      throw new TypeError(`words[${index}] 不是有效单词`);
    }
    return lowercase;
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('words 包含重复单词，无法保证对不同输出均匀抽样');
  }

  return normalized;
}

function normalizeWordCount(wordCount) {
  if (!Number.isSafeInteger(wordCount) || wordCount < 1 || wordCount > MAX_WORD_COUNT) {
    throw new RangeError(`wordCount 必须是 1～${MAX_WORD_COUNT} 的安全整数`);
  }
  return wordCount;
}

function normalizeCapitalization(capitalization) {
  if (!CAPITALIZATION_MODES.has(capitalization)) {
    throw new TypeError(`capitalization 不受支持：${String(capitalization)}`);
  }
  return capitalization;
}

function normalizeSeparator(separator, separatorSymbols, gapCount) {
  if (!SEPARATOR_MODES.has(separator)) {
    throw new TypeError(`separator 不受支持：${String(separator)}`);
  }

  if (Object.hasOwn(FIXED_SEPARATORS, separator)) {
    return [FIXED_SEPARATORS[separator]];
  }
  if (separator === 'random-digit') {
    return [...DIGIT_SEPARATORS];
  }

  const choices = uniqueCharacters(separatorSymbols);
  if (gapCount > 0 && choices.length === 0) {
    throw new RangeError('random-symbol 在多词短语中要求 separatorSymbols 至少包含一个符号');
  }
  return choices;
}

function assertRandomUppercaseIsDistinct(words, capitalization) {
  if (capitalization !== 'random-uppercase') return;
  const invariant = words.find((word) => word.toUpperCase() === word);
  if (invariant !== undefined) {
    throw new TypeError(`random-uppercase 要求每个单词都具有大小写形式：${invariant}`);
  }
}

function capitalizationChoiceCount(capitalization, wordCount) {
  return capitalization === 'random-uppercase' ? wordCount : 1;
}

function buildConfigSnapshot(normalized) {
  return deepFreeze({
    wordCount: normalized.wordCount,
    wordPackId: normalized.wordPackId,
    wordPoolSize: normalized.words.length,
    capitalization: normalized.capitalization,
    separator: normalized.separator,
    separatorSymbols: normalized.separator === 'random-symbol'
      ? normalized.separatorChoices.join('')
      : '',
  });
}

function buildGenerationModel(normalized) {
  const wordPoolSize = normalized.words.length;
  const separatorGapCount = normalized.wordCount - 1;
  const capitalizationChoices = capitalizationChoiceCount(
    normalized.capitalization,
    normalized.wordCount,
  );
  const separatorChoicesPerGap = separatorGapCount === 0
    ? 1
    : normalized.separatorChoices.length;
  const wordSpace = BigInt(wordPoolSize) ** BigInt(normalized.wordCount);
  const capitalizationSpace = BigInt(capitalizationChoices);
  const separatorSpace = BigInt(separatorChoicesPerGap) ** BigInt(separatorGapCount);
  const searchSpace = wordSpace * capitalizationSpace * separatorSpace;
  const entropyBits = log2BigInt(searchSpace);

  return deepFreeze({
    kind: 'uniform-passphrase',
    sourceEntropyBits: entropyBits,
    minEntropyBits: entropyBits,
    shannonEntropyBits: entropyBits,
    searchSpace,
    averageGuessBits: Math.max(0, entropyBits - 1),
    wordPoolSize,
    wordCount: normalized.wordCount,
    independentWordDraws: true,
    capitalization: normalized.capitalization,
    capitalizationChoices,
    separator: normalized.separator,
    separatorGapCount,
    separatorChoicesPerGap,
    poolSizes: deepFreeze({
      words: wordPoolSize,
      capitalization: capitalizationChoices,
      separatorPerGap: separatorChoicesPerGap,
    }),
    alphabet: null,
    randomByteLength: null,
    encoding: null,
    prefix: '',
    checksumBits: 0,
    standard: null,
  });
}

export function normalizePassphraseConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config 必须是对象');
  }

  const wordCount = normalizeWordCount(config.wordCount);
  const words = normalizeWords(config.words);
  const capitalization = normalizeCapitalization(config.capitalization);
  const separator = config.separator;
  const separatorGapCount = wordCount - 1;
  const separatorChoices = normalizeSeparator(
    separator,
    config.separatorSymbols,
    separatorGapCount,
  );

  assertRandomUppercaseIsDistinct(words, capitalization);

  return deepFreeze({
    wordCount,
    words,
    wordPackId: typeof config.wordPackId === 'string' && config.wordPackId
      ? config.wordPackId
      : 'custom',
    capitalization,
    separator,
    separatorChoices,
  });
}

export function createPassphraseModel(config) {
  const normalized = normalizePassphraseConfig(config);
  const generationModel = buildGenerationModel(normalized);
  return deepFreeze({
    ...generationModel,
    normalized,
    configSnapshot: buildConfigSnapshot(normalized),
  });
}

function capitalizeFirst(word) {
  const [first = '', ...rest] = [...word];
  return first.toUpperCase() + rest.join('');
}

function applyCapitalization(words, mode, cryptoLike) {
  if (mode === 'first-word') {
    words[0] = capitalizeFirst(words[0]);
  } else if (mode === 'every-word') {
    for (let index = 0; index < words.length; index += 1) {
      words[index] = capitalizeFirst(words[index]);
    }
  } else if (mode === 'random-uppercase') {
    const target = secureInt(words.length, cryptoLike);
    words[target] = words[target].toUpperCase();
  }
}

function sampleChoice(values, cryptoLike) {
  return values[secureInt(values.length, cryptoLike)];
}

export function generatePassphrase(config, cryptoLike = globalThis.crypto) {
  const model = createPassphraseModel(config);
  const { normalized } = model;
  const selectedWords = Array.from(
    { length: normalized.wordCount },
    () => sampleChoice(normalized.words, cryptoLike),
  );

  applyCapitalization(selectedWords, normalized.capitalization, cryptoLike);

  let value = selectedWords[0];
  for (let index = 1; index < selectedWords.length; index += 1) {
    value += sampleChoice(normalized.separatorChoices, cryptoLike) + selectedWords[index];
  }

  const { normalized: _normalized, configSnapshot, ...generationModel } = model;
  return createGenerationResult({
    type: 'passphrase',
    schemeId: 'passphrase',
    value,
    configSnapshot,
    generationModel,
  });
}
