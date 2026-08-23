import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WordPackManager, WordPackError } = require('../assets/js/word-pack-manager.js');

const payload = { id: 'demo', version: '1.0.0', entries: [{ id: 1, word: 'orbit' }] };
const raw = JSON.stringify(payload);
const digest = createHash('sha256').update(raw).digest('hex');
const manifest = { packs: [{ id: 'demo', path: 'en/demo.json', count: 1, sha256: digest }] };

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 500, text: async () => body, json: async () => JSON.parse(body) };
}

test('成功加载并对并发请求去重', async () => {
  let calls = 0;
  const fetchImpl = async url => {
    calls += 1;
    return url.endsWith('manifest.v1.json') ? response(JSON.stringify(manifest)) : response(raw);
  };
  const manager = new WordPackManager({ baseURL: 'https://local.test/assets/wordpacks/', fetchImpl, cryptoImpl: webcrypto });
  const [a, b] = await Promise.all([manager.load('demo'), manager.load('demo')]);
  assert.equal(a.entries[0].word, 'orbit');
  assert.strictEqual(a, b);
  assert.equal(calls, 2);
});

test('数量和哈希不符时明确失败', async () => {
  const badCountManifest = { packs: [{ ...manifest.packs[0], count: 2 }] };
  const countManager = new WordPackManager({
    baseURL: 'https://local.test/assets/wordpacks/',
    fetchImpl: async url => url.endsWith('manifest.v1.json') ? response(JSON.stringify(badCountManifest)) : response(raw),
    cryptoImpl: webcrypto,
  });
  await assert.rejects(countManager.load('demo'), error => error instanceof WordPackError && error.code === 'COUNT_MISMATCH');

  const badHashManifest = { packs: [{ ...manifest.packs[0], sha256: '0'.repeat(64) }] };
  const hashManager = new WordPackManager({
    baseURL: 'https://local.test/assets/wordpacks/',
    fetchImpl: async url => url.endsWith('manifest.v1.json') ? response(JSON.stringify(badHashManifest)) : response(raw),
    cryptoImpl: webcrypto,
  });
  await assert.rejects(hashManager.load('demo'), error => error instanceof WordPackError && error.code === 'HASH_MISMATCH');
});

test('主词包失败时可显式回退且返回降级原因', async () => {
  const fallbackPayload = { id: 'fallback', version: '1.0.0', entries: [{ id: 1, word: 'lamp' }] };
  const fallbackRaw = JSON.stringify(fallbackPayload);
  const fallbackDigest = createHash('sha256').update(fallbackRaw).digest('hex');
  const fallbackManifest = {
    packs: [
      { id: 'primary', path: 'en/primary.json', count: 1, sha256: '0'.repeat(64) },
      { id: 'fallback', path: 'en/fallback.json', count: 1, sha256: fallbackDigest },
    ],
  };
  const manager = new WordPackManager({
    baseURL: 'https://local.test/assets/wordpacks/',
    fetchImpl: async url => {
      if (url.endsWith('manifest.v1.json')) return response(JSON.stringify(fallbackManifest));
      if (url.endsWith('fallback.json')) return response(fallbackRaw);
      return response('network error', false);
    },
    cryptoImpl: webcrypto,
  });
  const loaded = await manager.loadWithFallback('primary', 'fallback');
  assert.equal(loaded.pack.id, 'fallback');
  assert.equal(loaded.fallbackFrom, 'primary');
  assert.ok(loaded.reason.includes('primary'));
});

test('缓存词包哈希过期时删除旧缓存并重新请求同源文件', async () => {
  let networkPackCalls = 0;
  let deleted = false;
  const staleResponse = response(JSON.stringify({ ...payload, entries: [{ id: 1, word: 'stale' }] }));
  const cacheStorage = {
    async open() {
      return {
        match: async () => staleResponse,
        delete: async () => { deleted = true; },
        put: async () => {},
      };
    },
  };
  const manager = new WordPackManager({
    baseURL: 'https://local.test/assets/wordpacks/',
    cacheStorage,
    fetchImpl: async url => {
      if (url.endsWith('manifest.v1.json')) return response(JSON.stringify(manifest));
      networkPackCalls += 1;
      return response(raw);
    },
    cryptoImpl: webcrypto,
  });
  const pack = await manager.load('demo');
  assert.equal(pack.entries[0].word, 'orbit');
  assert.equal(deleted, true);
  assert.equal(networkPackCalls, 1);
});
