import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import { wordlist as french } from '@scure/bip39/wordlists/french.js';

import {
  bip39CompatibilityNotice,
  generateMnemonicFromEntropy,
  getBip39WordlistStatus,
  registerBip39Wordlist,
} from '../../src/v201/bip39-model.mjs';

function hashWords(words) {
  return createHash('sha256').update(words.join('\n')).digest('hex');
}

test('BIP39 注册前验证 2048 词官方词表固定 SHA-256', async () => {
  const englishSha = hashWords(english);
  await registerBip39Wordlist('english', english, englishSha, webcrypto);
  assert.deepEqual(getBip39WordlistStatus('english'), {
    language: 'english',
    state: 'ready',
    wordCount: 2048,
    sha256: englishSha,
  });

  await assert.rejects(
    () => registerBip39Wordlist('french', french, '0'.repeat(64), webcrypto),
    /SHA-256/u,
  );
  assert.equal(getBip39WordlistStatus('french').state, 'idle');
});

test('BIP39 结果记录 ENT/CS/语言/词表哈希与校验和状态', async () => {
  const frenchSha = hashWords(french);
  await registerBip39Wordlist('french', french, frenchSha, webcrypto);
  const result = generateMnemonicFromEntropy(new Uint8Array(16), 'french');

  assert.equal(result.configSnapshot.entropyBits, 128);
  assert.equal(result.configSnapshot.checksumBits, 4);
  assert.equal(result.configSnapshot.language, 'french');
  assert.equal(result.generationModel.wordlistSha256, frenchSha);
  assert.equal(result.generationModel.presentationProfile, 'bip39');
  assert.equal(result.checksumValid, true);
});

test('非 English 词表和真实资产边界使用显著警告', () => {
  const englishNotice = bip39CompatibilityNotice('english');
  const localizedNotice = bip39CompatibilityNotice('japanese');
  assert.equal(englishNotice.compatibilityWarning, null);
  assert.match(localizedNotice.compatibilityWarning, /多数钱包.*English/u);
  assert.match(localizedNotice.assetSafetyWarning, /硬件钱包|离线构建/u);
});

