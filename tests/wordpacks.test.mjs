import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'assets/wordpacks/manifest.v1.json');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

test('manifest 声明简单、标准和六个主题词包', async () => {
  const manifest = await readJson(manifestPath);
  const expected = {
    'common-short': 1296,
    'memorable-long': 7776,
    technology: 1024,
    'cloud-devops': 1024,
    'network-security': 1024,
    'finance-web3': 1024,
    'science-space': 1024,
    'business-office': 1024,
  };
  assert.deepEqual(Object.fromEntries(manifest.packs.map(pack => [pack.id, pack.count])), expected);
});

test('每个词包数量、唯一性、元数据和 SHA-256 均有效', async () => {
  const manifest = await readJson(manifestPath);
  const globallyUniqueProfessionalWords = new Set();
  let standardWords = new Set();
  for (const descriptor of manifest.packs) {
    const file = path.join(root, 'assets/wordpacks', descriptor.path);
    const raw = await readFile(file);
    const payload = JSON.parse(raw.toString('utf8'));
    assert.equal(payload.id, descriptor.id);
    assert.equal(payload.entries.length, descriptor.count);
    assert.equal(new Set(payload.entries.map(entry => entry.word)).size, descriptor.count);
    assert.equal(createHash('sha256').update(raw).digest('hex'), descriptor.sha256);
    for (const entry of payload.entries) {
      assert.equal(typeof entry.id, 'number');
      assert.match(entry.word, /^[a-z][a-z'-]{2,11}$/);
      assert.equal(entry.locale, 'en');
      assert.ok(Array.isArray(entry.pos) && entry.pos.length > 0);
      assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0);
      assert.ok([1, 2, 3].includes(entry.difficulty));
      assert.ok([1, 2, 3].includes(entry.imageability));
      assert.ok([1, 2, 3].includes(entry.frequency));
      assert.equal(entry.sensitive, false);
      assert.equal(entry.ambiguous, false);
      if (descriptor.kind === 'theme') {
        assert.equal(standardWords.has(entry.word), false, `主题词与标准词库重复：${entry.word}`);
        assert.equal(globallyUniqueProfessionalWords.has(entry.word), false, `主题词重复：${entry.word}`);
        globallyUniqueProfessionalWords.add(entry.word);
      }
    }
    if (descriptor.id === 'memorable-long') {
      standardWords = new Set(payload.entries.map(entry => entry.word));
    }
  }
  assert.equal(globallyUniqueProfessionalWords.size, 6144);
});
