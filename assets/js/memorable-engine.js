(function attachMemorableEngine(globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.MemorableEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMemorableEngine() {
  'use strict';

  function secureRandomIndex(size, cryptoImpl = globalThis.crypto) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > 0xffffffff) {
      throw new RangeError('词池大小必须是 1～4,294,967,295 之间的安全整数。');
    }
    if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') {
      throw new Error('当前环境不支持 Web Crypto，无法安全生成记忆短语。');
    }

    const range = 0x100000000;
    const limit = Math.floor(range / size) * size;
    const buffer = new Uint32Array(1);
    let value;
    do {
      cryptoImpl.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return value % size;
  }

  class SecureWordGenerator {
    constructor(cryptoImpl = globalThis.crypto) {
      this.crypto = cryptoImpl;
    }

    generate(entries, count) {
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new RangeError('词包为空，无法生成记忆短语。');
      }
      if (!Number.isSafeInteger(count) || count <= 0 || count > 100) {
        throw new RangeError('单词数量必须是 1～100 之间的整数。');
      }

      return Array.from({ length: count }, () => {
        const entry = entries[secureRandomIndex(entries.length, this.crypto)];
        return typeof entry === 'string' ? entry : entry.word;
      });
    }
  }

  const EntropyCalculator = {
    forWords(poolSize, wordCount) {
      if (!Number.isSafeInteger(poolSize) || poolSize <= 0) {
        throw new RangeError('实际词池数量无效。');
      }
      if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
        throw new RangeError('单词数量无效。');
      }

      const bitsPerWord = Math.log2(poolSize);
      return {
        poolSize,
        wordCount,
        bitsPerWord,
        totalBits: bitsPerWord * wordCount,
        contextBits: 0,
      };
    },
  };

  return {
    secureRandomIndex,
    SecureWordGenerator,
    EntropyCalculator,
  };
});
