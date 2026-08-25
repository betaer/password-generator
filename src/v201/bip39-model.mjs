import {
  entropyToMnemonic,
  validateMnemonic as validateBip39Mnemonic,
} from '@scure/bip39';

import { secureRandomBytes } from '../v2/random-core.mjs';
import { createPowerOfTwoSearchSpace } from './probability-contract.mjs';
import { createGenerationResult } from './result-model.mjs';
import { verifyWordArraySha256 } from './asset-integrity.mjs';

export const BIP39_ENTROPY_BITS = Object.freeze([128, 160, 192, 224, 256]);
const ENTROPY_SET = new Set(BIP39_ENTROPY_BITS);
const registry = new Map();

function normalizeLanguage(value) {
  if (typeof value !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/u.test(value)) {
    throw new RangeError('BIP39 language must be a stable lowercase identifier');
  }
  return value;
}

function validateWords(words) {
  if (!Array.isArray(words) || words.length !== 2048 || new Set(words).size !== 2048) {
    throw new RangeError('BIP39 wordlist must contain 2048 unique words');
  }
  if (words.some((word) => typeof word !== 'string' || !word || word.normalize('NFKD') !== word)) {
    throw new RangeError('BIP39 words must be non-empty NFKD strings');
  }
  return Object.freeze([...words]);
}

export async function registerBip39Wordlist(language, words, expectedSha256, cryptoLike = globalThis.crypto) {
  const normalized = normalizeLanguage(language);
  const immutableWords = validateWords(words);
  const sha256 = await verifyWordArraySha256(immutableWords, expectedSha256, cryptoLike);
  const existing = registry.get(normalized);
  if (existing && existing.sha256 !== sha256) throw new Error(`BIP39 wordlist already registered: ${normalized}`);
  if (!existing) registry.set(normalized, Object.freeze({ words: immutableWords, sha256 }));
  return getBip39WordlistStatus(normalized);
}

export function getBip39WordlistStatus(language) {
  const normalized = normalizeLanguage(language);
  const entry = registry.get(normalized);
  return Object.freeze({
    language: normalized,
    state: entry ? 'ready' : 'idle',
    wordCount: entry ? 2048 : 0,
    sha256: entry?.sha256 ?? null,
  });
}

function requireEntropyBits(bits) {
  if (!Number.isSafeInteger(bits) || !ENTROPY_SET.has(bits)) throw new RangeError('invalid BIP39 entropy bits');
  return bits;
}

function createMnemonicResult(entropy, language) {
  const entry = registry.get(normalizeLanguage(language));
  if (!entry) throw new Error(`BIP39 wordlist is not ready: ${language}`);
  const entropyBits = requireEntropyBits(entropy.byteLength * 8);
  const checksumBits = entropyBits / 32;
  const separator = language === 'japanese' ? '\u3000' : ' ';
  const value = entropyToMnemonic(entropy, entry.words);
  const words = Object.freeze(value.split(separator));
  const result = createGenerationResult({
    type: 'mnemonic',
    schemeId: 'bip39-mnemonic-v201',
    value,
    bytes: entropy,
    configSnapshot: {
      language,
      entropyBits,
      checksumBits,
      wordCount: words.length,
      separator,
      wordlistSha256: entry.sha256,
    },
    generationModel: {
      searchSpace: createPowerOfTwoSearchSpace(entropyBits),
      generatorMinEntropyBits: entropyBits,
      generatorShannonEntropyBits: entropyBits,
      nominalCsprngOutputBits: entropyBits,
      randomSourceBytesRequested: entropy.byteLength,
      randomSourceConsumptionModel: 'fixed-byte-request',
      presentationProfile: 'bip39',
      standard: 'BIP39',
      entropyBits,
      checksumBits,
      wordCount: words.length,
      language,
      wordlistSha256: entry.sha256,
    },
  });
  return Object.freeze({
    ...result,
    words,
    checksumValid: validateBip39Mnemonic(value, entry.words),
  });
}

export function generateMnemonic(config = {}, cryptoLike = globalThis.crypto) {
  const entropyBits = requireEntropyBits(config.entropyBits ?? 128);
  const language = normalizeLanguage(config.language ?? 'english');
  return createMnemonicResult(secureRandomBytes(entropyBits / 8, cryptoLike), language);
}

export function generateMnemonicFromEntropy(entropy, language = 'english') {
  if (!(entropy instanceof Uint8Array)) throw new TypeError('entropy must be a Uint8Array');
  requireEntropyBits(entropy.byteLength * 8);
  return createMnemonicResult(Uint8Array.from(entropy), normalizeLanguage(language));
}

export function validateMnemonic(value, language = 'english') {
  const entry = registry.get(normalizeLanguage(language));
  return Boolean(entry && typeof value === 'string' && validateBip39Mnemonic(value, entry.words));
}

export function bip39CompatibilityNotice(language) {
  const normalized = normalizeLanguage(language);
  return Object.freeze({
    compatibilityWarning: normalized === 'english'
      ? null
      : '兼容性警告：多数钱包只保证 English BIP39 词表兼容。请先验证目标钱包的导入和恢复能力。',
    assetSafetyWarning: '高价值真实资产优先使用硬件钱包或经过验证的离线构建；浏览器扩展、系统恶意软件、屏幕与剪贴板监听不在本页保护边界内。',
  });
}

