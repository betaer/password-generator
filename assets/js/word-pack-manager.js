(function attachWordPackManager(globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.WordPackRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWordPackManager() {
  'use strict';

  class WordPackError extends Error {
    constructor(code, message, cause) {
      super(message, cause ? { cause } : undefined);
      this.name = 'WordPackError';
      this.code = code;
    }
  }

  function joinURL(base, relative) {
    return new URL(relative, base).href;
  }

  async function sha256Hex(text, cryptoImpl) {
    if (!cryptoImpl?.subtle?.digest) return null;
    const bytes = new TextEncoder().encode(text);
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  class WordPackManager {
    constructor(options = {}) {
      this.baseURL = options.baseURL || './assets/wordpacks/';
      this.manifestName = options.manifestName || 'manifest.v1.json';
      this.fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
      this.cryptoImpl = options.cryptoImpl || globalThis.crypto;
      this.cacheStorage = options.cacheStorage === undefined ? globalThis.caches : options.cacheStorage;
      this.cacheName = options.cacheName || 'password-generator-wordpacks-v1';
      this.manifestPromise = null;
      this.inflight = new Map();
      this.memory = new Map();
    }

    async getManifest() {
      if (!this.manifestPromise) {
        this.manifestPromise = this.fetchJsonText(joinURL(this.baseURL, this.manifestName), false)
          .then(({ text }) => {
            const manifest = JSON.parse(text);
            if (!Array.isArray(manifest.packs)) throw new WordPackError('INVALID_MANIFEST', '词包清单格式无效。');
            return manifest;
          })
          .catch(error => {
            this.manifestPromise = null;
            if (error instanceof WordPackError) throw error;
            throw new WordPackError('MANIFEST_LOAD_FAILED', `无法加载词包清单：${error.message}`, error);
          });
      }
      return this.manifestPromise;
    }

    async fetchJsonText(url, cacheable = true, skipCacheRead = false) {
      if (typeof this.fetchImpl !== 'function') {
        throw new WordPackError('FETCH_UNAVAILABLE', '当前环境无法加载异步词包。');
      }
      let cache = null;
      if (cacheable && this.cacheStorage?.open) {
        try {
          cache = await this.cacheStorage.open(this.cacheName);
          if (!skipCacheRead) {
            const cached = await cache.match(url);
            if (cached) return { text: await cached.text(), source: 'cache' };
          }
        } catch {
          cache = null;
        }
      }
      let response;
      try {
        response = await this.fetchImpl(url, { credentials: 'same-origin', cache: 'no-cache' });
      } catch (error) {
        throw new WordPackError('NETWORK_ERROR', `词包网络请求失败：${url}`, error);
      }
      if (!response?.ok) throw new WordPackError('HTTP_ERROR', `词包请求失败（HTTP ${response?.status || 0}）：${url}`);
      const text = await response.text();
      if (cache && response.clone) {
        try { await cache.put(url, response.clone()); } catch { /* 缓存失败不影响本次加载 */ }
      }
      return { text, source: 'network' };
    }

    async load(id) {
      if (this.memory.has(id)) return this.memory.get(id);
      if (this.inflight.has(id)) return this.inflight.get(id);
      const task = this.loadUnchecked(id).finally(() => this.inflight.delete(id));
      this.inflight.set(id, task);
      return task;
    }

    async loadUnchecked(id) {
      const manifest = await this.getManifest();
      const descriptor = manifest.packs.find(pack => pack.id === id);
      if (!descriptor) throw new WordPackError('PACK_NOT_FOUND', `词包不存在：${id}`);
      const url = joinURL(this.baseURL, descriptor.path);
      let loaded = await this.fetchJsonText(url, true);
      let digest = await sha256Hex(loaded.text, this.cryptoImpl);
      if (digest && digest !== descriptor.sha256 && loaded.source === 'cache') {
        try {
          const cache = await this.cacheStorage?.open?.(this.cacheName);
          await cache?.delete?.(url);
        } catch { /* 旧缓存清理失败时仍强制绕过缓存重试 */ }
        loaded = await this.fetchJsonText(url, true, true);
        digest = await sha256Hex(loaded.text, this.cryptoImpl);
      }
      if (digest && digest !== descriptor.sha256) {
        throw new WordPackError('HASH_MISMATCH', `词包 ${id} 完整性校验失败。`);
      }
      let payload;
      try { payload = JSON.parse(loaded.text); }
      catch (error) { throw new WordPackError('INVALID_JSON', `词包 ${id} 不是有效 JSON。`, error); }
      if (payload.id !== id || !Array.isArray(payload.entries)) {
        throw new WordPackError('INVALID_PACK', `词包 ${id} 结构无效。`);
      }
      if (payload.entries.length !== descriptor.count) {
        throw new WordPackError('COUNT_MISMATCH', `词包 ${id} 应有 ${descriptor.count} 词，实际为 ${payload.entries.length} 词。`);
      }
      const unique = new Set(payload.entries.map(entry => entry.word));
      if (unique.size !== descriptor.count) {
        throw new WordPackError('DUPLICATE_WORDS', `词包 ${id} 含有重复词条。`);
      }
      const pack = {
        ...payload,
        descriptor,
        loadSource: loaded.source,
        integrityVerified: Boolean(digest),
      };
      this.memory.set(id, pack);
      return pack;
    }

    async loadWithFallback(primaryId, fallbackId) {
      try {
        return { pack: await this.load(primaryId), fallbackFrom: null, reason: '' };
      } catch (primaryError) {
        const pack = await this.load(fallbackId);
        return {
          pack,
          fallbackFrom: primaryId,
          reason: `${primaryId} 加载失败：${primaryError.message}`,
          error: primaryError,
        };
      }
    }

    clearMemory() {
      this.memory.clear();
      this.inflight.clear();
    }
  }

  return { WordPackManager, WordPackError, sha256Hex };
});
