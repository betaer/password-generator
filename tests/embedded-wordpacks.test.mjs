import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const expected = new Map([
  ['common-short', 1296],
  ['memorable-long', 7776],
  ['technology', 1024],
  ['cloud-devops', 1024],
  ['network-security', 1024],
  ['finance-web3', 1024],
  ['science-space', 1024],
  ['business-office', 1024],
]);

test('file 协议预览副本包含全部八个词包且数量、唯一性正确', async () => {
  const source = await readFile(new URL('../assets/js/embedded-word-packs.js', import.meta.url), 'utf8');
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const store = sandbox.EmbeddedWordPacksV1;
  assert.equal(store.version, '1.0.0');
  assert.deepEqual(Object.keys(store.packs).sort(), [...expected.keys()].sort());
  for (const [id, count] of expected) {
    const pack = store.packs[id];
    assert.equal(pack.entries.length, count, id);
    assert.equal(new Set(pack.entries).size, count, id);
    assert.equal(pack.descriptor.count, count, id);
    assert.match(pack.descriptor.sha256, /^[a-f0-9]{64}$/);
  }
});
