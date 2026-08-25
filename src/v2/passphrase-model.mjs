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

function capitalizationTransform(word, capitalization) {
  if (capitalization === 'first-word' || capitalization === 'every-word') {
    return capitalizeFirst(word);
  }
  if (capitalization === 'random-uppercase') return word.toUpperCase();
  return word;
}

function assertCapitalizationIsInjective(words, capitalization) {
  if (capitalization === 'lowercase') return;
  const transformed = words.map((word) => capitalizationTransform(word, capitalization));
  if (new Set(transformed).size !== transformed.length) {
    throw new TypeError('大小写转换必须让每个候选单词保持不同输出');
  }
  if (capitalization !== 'random-uppercase') return;
  const originals = new Set(words);
  if (transformed.some((word, index) => word === words[index] || originals.has(word))) {
    throw new TypeError('random-uppercase 的大小写结果必须与所有原始单词保持不同输出');
  }
}

function filterCapitalizationCollisions(words, capitalization) {
  if (capitalization === 'lowercase') return words;
  const accepted = [];
  const acceptedOriginals = new Set();
  const acceptedTransforms = new Set();
  for (const word of words) {
    const transformed = capitalizationTransform(word, capitalization);
    const randomCollision = capitalization === 'random-uppercase'
      && (transformed === word
        || acceptedOriginals.has(transformed)
        || acceptedTransforms.has(word));
    if (randomCollision || acceptedTransforms.has(transformed)) continue;
    accepted.push(word);
    acceptedOriginals.add(word);
    acceptedTransforms.add(transformed);
  }
  return accepted;
}

function renderedWordVariants(word, capitalization, wordCount) {
  if (capitalization === 'first-word') {
    return wordCount === 1 ? [capitalizeFirst(word)] : [word, capitalizeFirst(word)];
  }
  if (capitalization === 'every-word') return [capitalizeFirst(word)];
  if (capitalization === 'random-uppercase') {
    return wordCount === 1 ? [word.toUpperCase()] : [word, word.toUpperCase()];
  }
  return [word];
}

function wordConflictsWithSeparators(word, capitalization, wordCount, separatorChoices) {
  return renderedWordVariants(word, capitalization, wordCount).some((variant) => (
    separatorChoices.some((choice) => variant.includes(choice))
  ));
}

function capitalizationChoiceCount(capitalization, wordCount) {
  return capitalization === 'random-uppercase' ? wordCount : 1;
}

function buildConfigSnapshot(normalized) {
  return deepFreeze({
    wordCount: normalized.wordCount,
    wordPackId: normalized.wordPackId,
    wordPoolSize: normalized.words.length,
    sourceWordPoolSize: normalized.sourceWordPoolSize,
    excludedAmbiguousWordCount: normalized.sourceWordPoolSize - normalized.words.length,
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
    sourceWordPoolSize: normalized.sourceWordPoolSize,
    excludedAmbiguousWordCount: normalized.sourceWordPoolSize - wordPoolSize,
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
  if (separatorGapCount > 0 && words.some((word) => (
    wordConflictsWithSeparators(word, capitalization, wordCount, separatorChoices)
  ))) {
    throw new RangeError('分隔符候选不能出现在单词中，否则无法保证不同抽样路径对应不同输出');
  }
  const sourceWordPoolSize = config.sourceWordPoolSize ?? words.length;
  if (!Number.isSafeInteger(sourceWordPoolSize) || sourceWordPoolSize < words.length) {
    throw new RangeError('sourceWordPoolSize 必须是不小于实际词池的安全整数');
  }

  assertCapitalizationIsInjective(words, capitalization);

  return deepFreeze({
    wordCount,
    words,
    sourceWordPoolSize,
    wordPackId: typeof config.wordPackId === 'string' && config.wordPackId
      ? config.wordPackId
      : 'custom',
    capitalization,
    separator,
    separatorChoices,
  });
}

/**
 * Returns the deterministic, order-preserving subset whose rendered phrases
 * remain uniquely decodable for the selected separator and casing mode.
 * The UI uses this before creating the model; the model itself still rejects
 * ambiguous caller input instead of silently changing a public API request.
 */
export function getCompatiblePassphraseWords(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config 必须是对象');
  }
  const wordCount = normalizeWordCount(config.wordCount);
  const words = normalizeWords(config.words);
  const capitalization = normalizeCapitalization(config.capitalization);
  const separatorChoices = normalizeSeparator(
    config.separator,
    config.separatorSymbols,
    wordCount - 1,
  );
  const separatorSafe = wordCount === 1
    ? words
    : words.filter((word) => !wordConflictsWithSeparators(
      word,
      capitalization,
      wordCount,
      separatorChoices,
    ));
  const compatible = filterCapitalizationCollisions(separatorSafe, capitalization);
  if (compatible.length === 0) {
    throw new RangeError('当前分隔符与大小写设置没有可安全区分的候选单词');
  }
  return Object.freeze(compatible);
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
