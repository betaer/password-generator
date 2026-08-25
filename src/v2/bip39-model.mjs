import {
  entropyToMnemonic,
  validateMnemonic as validateBip39Mnemonic,
} from '@scure/bip39';

import { secureRandomBytes } from './random-core.mjs';
import { createGenerationResult } from './result-model.mjs';

export const BIP39_ENTROPY_BITS = Object.freeze([128, 160, 192, 224, 256]);

const BIP39_ENTROPY_BIT_SET = new Set(BIP39_ENTROPY_BITS);
const BIP39_WORD_COUNT = 2048;
const BIP39_STANDARD = 'BIP39';
const JAPANESE_LANGUAGE = 'japanese';
const ASCII_SPACE = ' ';
const IDEOGRAPHIC_SPACE = '\u3000';
const wordlistRegistry = new Map();

function normalizeLanguage(language) {
  if (typeof language !== 'string') {
    throw new TypeError('language must be a string');
  }
  const normalized = language.trim().toLowerCase();
  if (!/^[a-z]+(?:-[a-z]+)*$/u.test(normalized)) {
    throw new RangeError('language must be a stable lowercase language identifier');
  }
  return normalized;
}

function requireWordlist(words) {
  if (!Array.isArray(words) || words.length !== BIP39_WORD_COUNT) {
    throw new RangeError('BIP39 wordlist must contain exactly 2048 words');
  }

  const copy = words.map((word, index) => {
    if (typeof word !== 'string' || word.length === 0) {
      throw new TypeError(`BIP39 wordlist entry ${index} must be a non-empty string`);
    }
    if (word.normalize('NFKD') !== word) {
      throw new RangeError(`BIP39 wordlist entry ${index} must use NFKD normalization`);
    }
    return word;
  });
  if (new Set(copy).size !== BIP39_WORD_COUNT) {
    throw new RangeError('BIP39 wordlist entries must be unique');
  }
  return Object.freeze(copy);
}

function wordlistsEqual(left, right) {
  return left.length === right.length
    && left.every((word, index) => word === right[index]);
}

function requireRegisteredWordlist(language) {
  const normalizedLanguage = normalizeLanguage(language);
  const words = wordlistRegistry.get(normalizedLanguage);
  if (!words) {
    throw new Error(`BIP39 wordlist is not ready: ${normalizedLanguage}`);
  }
  return { language: normalizedLanguage, words };
}

function requireEntropyBits(entropyBits) {
  if (!Number.isSafeInteger(entropyBits) || !BIP39_ENTROPY_BIT_SET.has(entropyBits)) {
    throw new RangeError('BIP39 entropy must be one of 128、160、192、224、256 bits');
  }
  return entropyBits;
}

function requireConfig(config) {
  if (config === undefined) return {};
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  return config;
}

function createMnemonicResult(entropy, language, words) {
  const entropyBits = entropy.length * 8;
  const checksumBits = entropyBits / 32;
  const separator = language === JAPANESE_LANGUAGE
    ? IDEOGRAPHIC_SPACE
    : ASCII_SPACE;
  const value = entropyToMnemonic(entropy, words);
  const mnemonicWords = Object.freeze(value.split(separator));
  const result = createGenerationResult({
    type: 'mnemonic',
    schemeId: 'bip39-mnemonic',
    value,
    bytes: entropy,
    configSnapshot: {
      language,
      entropyBits,
      wordCount: mnemonicWords.length,
      separator,
    },
    generationModel: {
      sourceEntropyBits: entropyBits,
      minEntropyBits: entropyBits,
      shannonEntropyBits: entropyBits,
      averageGuessBits: Math.max(0, entropyBits - 1),
      searchSpace: 1n << BigInt(entropyBits),
      checksumBits,
      randomByteLength: entropy.length,
      wordCount: mnemonicWords.length,
      wordlistSize: BIP39_WORD_COUNT,
      poolSizes: { wordlist: BIP39_WORD_COUNT },
      language,
      separator,
      standard: BIP39_STANDARD,
    },
  });

  return Object.freeze({
    ...result,
    words: mnemonicWords,
  });
}

/** Registers one immutable official BIP39 wordlist. */
export function registerBip39Wordlist(language, words) {
  const normalizedLanguage = normalizeLanguage(language);
  const immutableWords = requireWordlist(words);
  const existing = wordlistRegistry.get(normalizedLanguage);

  if (existing) {
    if (!wordlistsEqual(existing, immutableWords)) {
      throw new Error(`BIP39 wordlist is already registered: ${normalizedLanguage}`);
    }
    return getBip39WordlistStatus(normalizedLanguage);
  }

  wordlistRegistry.set(normalizedLanguage, immutableWords);
  return getBip39WordlistStatus(normalizedLanguage);
}

export function getBip39WordlistStatus(language) {
  const normalizedLanguage = normalizeLanguage(language);
  const isReady = wordlistRegistry.has(normalizedLanguage);
  return Object.freeze({
    language: normalizedLanguage,
    state: isReady ? 'ready' : 'idle',
    wordCount: isReady ? BIP39_WORD_COUNT : 0,
  });
}

export function generateMnemonic(config = {}, cryptoLike = globalThis.crypto) {
  const normalizedConfig = requireConfig(config);
  const entropyBits = requireEntropyBits(normalizedConfig.entropyBits ?? 128);
  const language = normalizedConfig.language ?? 'english';
  const registered = requireRegisteredWordlist(language);
  const entropy = secureRandomBytes(entropyBits / 8, cryptoLike);
  return createMnemonicResult(entropy, registered.language, registered.words);
}

export function generateMnemonicFromEntropy(entropy, language = 'english') {
  if (!(entropy instanceof Uint8Array)) {
    throw new TypeError('entropy must be a Uint8Array');
  }
  requireEntropyBits(entropy.length * 8);
  const registered = requireRegisteredWordlist(language);
  const entropyCopy = Uint8Array.from(entropy);
  return createMnemonicResult(entropyCopy, registered.language, registered.words);
}

export function validateMnemonic(value, language = 'english') {
  const registered = requireRegisteredWordlist(language);
  if (typeof value !== 'string') {
    return false;
  }
  return validateBip39Mnemonic(value, registered.words);
}
