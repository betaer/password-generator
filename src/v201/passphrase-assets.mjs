import { sha256Text, verifyWordArraySha256 } from './asset-integrity.mjs';

const registry = new Map();

function normalizeId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new RangeError('passphrase pack id must be a stable lowercase identifier');
  }
  return value;
}

function normalizeWords(words) {
  if (!Array.isArray(words) || words.length === 0) throw new TypeError('passphrase pack must contain words');
  const copy = words.map((word, index) => {
    if (typeof word !== 'string' || word.trim() !== word || word === '') {
      throw new TypeError(`passphrase word ${index} is invalid`);
    }
    return word;
  });
  if (new Set(copy).size !== copy.length) throw new RangeError('passphrase pack words must be unique');
  return Object.freeze(copy);
}

export async function registerPassphrasePack(pack, cryptoLike = globalThis.crypto) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new TypeError('passphrase pack must be an object');
  const id = normalizeId(pack.id);
  if (typeof pack.version !== 'string' || pack.version.trim() === '') throw new TypeError('passphrase pack version is required');
  const words = normalizeWords(pack.words);
  const sha256 = await verifyWordArraySha256(words, pack.sha256, cryptoLike);
  const existing = registry.get(id);
  if (existing && existing.sha256 !== sha256) throw new Error(`passphrase pack is already registered: ${id}`);
  if (!existing) registry.set(id, Object.freeze({ id, version: pack.version, words, sha256 }));
  return getPassphrasePackStatus(id);
}

export function getPassphrasePackStatus(id) {
  const normalized = normalizeId(id);
  const pack = registry.get(normalized);
  return Object.freeze({
    id: normalized,
    state: pack ? 'ready' : 'idle',
    version: pack?.version ?? null,
    count: pack?.words.length ?? 0,
    sha256: pack?.sha256 ?? null,
  });
}

export function getPassphrasePack(id) {
  const normalized = normalizeId(id);
  const pack = registry.get(normalized);
  if (!pack) throw new Error(`passphrase pack is not ready: ${normalized}`);
  return pack;
}

export async function createPassphraseProvenance(id, effectiveWords, cryptoLike = globalThis.crypto) {
  const pack = getPassphrasePack(id);
  const normalizedEffective = normalizeWords(effectiveWords);
  const sourceWords = new Set(pack.words);
  if (normalizedEffective.some((word) => !sourceWords.has(word))) {
    throw new RangeError('effective passphrase pool must be a subset of the registered pack');
  }
  return Object.freeze({
    wordPackId: pack.id,
    wordPackVersion: pack.version,
    wordPackSha256: pack.sha256,
    effectiveWordPoolSha256: await sha256Text(normalizedEffective.join('\n'), cryptoLike),
    sourceWordPoolSize: pack.words.length,
    effectiveWordPoolSize: normalizedEffective.length,
  });
}

