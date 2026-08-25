import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

import {
  createPassphraseProvenance,
  getPassphrasePackStatus,
  registerPassphrasePack,
} from '../../src/v201/passphrase-assets.mjs';

function hashWords(words) {
  return createHash('sha256').update(words.join('\n')).digest('hex');
}

test('V2.0.1 Passphrase 词包独立注册并验证固定 SHA', async () => {
  const words = ['amber', 'breeze', 'cobalt', 'delta'];
  const sha256 = hashWords(words);
  await registerPassphrasePack({
    id: 'test-pack',
    version: '2.0.1',
    words,
    sha256,
  }, webcrypto);

  assert.deepEqual(getPassphrasePackStatus('test-pack'), {
    id: 'test-pack',
    state: 'ready',
    version: '2.0.1',
    count: 4,
    sha256,
  });
  await assert.rejects(() => registerPassphrasePack({
    id: 'bad-pack', version: '2.0.1', words, sha256: 'f'.repeat(64),
  }, webcrypto), /SHA-256/u);
});

test('生成快照记录词包与有效词池两个 SHA', async () => {
  const provenance = await createPassphraseProvenance(
    'test-pack',
    ['amber', 'breeze', 'delta'],
    webcrypto,
  );
  assert.equal(provenance.wordPackVersion, '2.0.1');
  assert.match(provenance.wordPackSha256, /^[0-9a-f]{64}$/u);
  assert.equal(provenance.effectiveWordPoolSha256, hashWords(['amber', 'breeze', 'delta']));
});

