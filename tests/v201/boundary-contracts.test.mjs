import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

import { generateApiSecret } from '../../src/v201/api-secret.mjs';
import { sha256Text, verifyWordArraySha256 } from '../../src/v201/asset-integrity.mjs';
import { generateAtomicBatch } from '../../src/v201/batch-generator.mjs';
import {
  generateMnemonic,
  generateMnemonicFromEntropy,
  getBip39WordlistStatus,
  registerBip39Wordlist,
  validateMnemonic,
} from '../../src/v201/bip39-model.mjs';
import { createGenerationCoordinator, createGenerationJob } from '../../src/v201/generation-job.mjs';
import { normalizeOptionalPrintableAscii } from '../../src/v201/input-validation.mjs';
import {
  createPassphraseProvenance,
  getPassphrasePack,
  getPassphrasePackStatus,
  registerPassphrasePack,
} from '../../src/v201/passphrase-assets.mjs';
import {
  createIntegerSearchSpace,
  expectedRankForSearchSpace,
  formatExpectedRank,
  formatSearchSpace,
  normalizeSearchSpace,
  probabilityBits,
} from '../../src/v201/probability-contract.mjs';
import { generateLazyRandomBytes, materializeRandomBytes } from '../../src/v201/random-bytes.mjs';
import {
  assertClipboardBudget,
  createHistoryBudget,
  estimateResultRetentionBytes,
} from '../../src/v201/resource-budget.mjs';
import { createGenerationResult } from '../../src/v201/result-model.mjs';
import { createSecurityAssessment } from '../../src/v201/security-assessment.mjs';
import { createPatternAnalysisCoordinator } from '../../src/v201/zxcvbn-coordinator.mjs';

function fixedCrypto(value = 0x11) {
  return {
    subtle: webcrypto.subtle,
    getRandomValues(view) {
      view.fill(value);
      return view;
    },
  };
}

function sha(words) {
  return createHash('sha256').update(words.join('\n')).digest('hex');
}

function generationModel(profile = 'password', overrides = {}) {
  return {
    searchSpace: createIntegerSearchSpace(2n),
    generatorMinEntropyBits: 1,
    generatorShannonEntropyBits: 1,
    presentationProfile: profile,
    ...overrides,
  };
}

test('API Secret 与完整性校验对畸形输入 fail closed', async () => {
  assert.throws(() => generateApiSecret(null, fixedCrypto()), /config/u);
  assert.throws(() => generateApiSecret({ prefix: 1 }, fixedCrypto()), /prefix/u);
  assert.throws(() => generateApiSecret({ prefix: 'bad\n' }, fixedCrypto()), /printable ASCII/u);
  assert.throws(() => generateApiSecret({ byteLength: 0 }, fixedCrypto()), /byteLength/u);
  assert.throws(() => generateApiSecret({ encoding: 'utf8' }, fixedCrypto()), /encoding/u);

  await assert.rejects(() => sha256Text(1, webcrypto), /string/u);
  await assert.rejects(() => sha256Text('text', {}), /subtle\.digest/u);
  await assert.rejects(() => verifyWordArraySha256([1], '0'.repeat(64), webcrypto), /string array/u);
  await assert.rejects(() => verifyWordArraySha256(['word'], 'ABC', webcrypto), /64 lowercase/u);
});

test('Atomic Batch 对无效依赖、过期任务和错误编译结果 fail closed', async () => {
  const coordinator = createGenerationCoordinator();
  const job = coordinator.begin('token', {}, 1);
  const valid = { job, compile: () => ({ sampleOne: () => ({ id: 'x' }) }), isCurrent: coordinator.isCurrent, clearResult() {} };

  await assert.rejects(() => generateAtomicBatch({ ...valid, job: null }), /job/u);
  await assert.rejects(() => generateAtomicBatch({ ...valid, compile: null }), /compile/u);
  await assert.rejects(() => generateAtomicBatch({ ...valid, isCurrent: null }), /isCurrent/u);
  await assert.rejects(() => generateAtomicBatch({ ...valid, clearResult: null }), /clearResult/u);

  coordinator.cancel();
  await assert.rejects(() => generateAtomicBatch(valid), /stale|cancel/u);

  const active = coordinator.begin('token', {}, 1);
  await assert.rejects(() => generateAtomicBatch({ ...valid, job: active, compile: () => null }), /compiled generator/u);
  await assert.rejects(() => generateAtomicBatch({
    ...valid,
    job: active,
    compile: () => ({ sampleBatch: async () => 'not-array' }),
  }), /array/u);
  await assert.rejects(() => generateAtomicBatch({
    ...valid,
    job: active,
    compile: () => ({}),
  }), /sampleOne/u);
});

test('Generation Job 拒绝非有限、非 plain object、循环外可变数据', () => {
  assert.throws(() => createGenerationJob({ id: 0, mode: 'pin', config: {}, quantity: 1 }), /positive/u);
  assert.throws(() => createGenerationJob({ id: 1, mode: 'pin', config: { value: Infinity }, quantity: 1 }), /finite/u);
  assert.throws(() => createGenerationJob({ id: 1, mode: 'pin', config: { value: Symbol('x') }, quantity: 1 }), /unsupported/u);
  assert.throws(() => createGenerationJob({ id: 1, mode: 'pin', config: { value: new Date() }, quantity: 1 }), /plain objects/u);
  assert.throws(() => createGenerationJob({ id: 1, mode: 'pin', config: { value: new ArrayBuffer(1) }, quantity: 1 }), /binary/u);

  const cyclic = { nested: {} };
  cyclic.nested.parent = cyclic;
  const job = createGenerationJob({ id: 1, mode: 'pin', config: cyclic, quantity: 1 });
  assert.equal(job.config.nested.parent, job.config);
  assert.equal(Object.isFrozen(job.config.nested), true);
});

test('BIP39 注册、生成和验证覆盖语言、词表与熵边界', async () => {
  assert.throws(() => getBip39WordlistStatus('Bad ID'), /language/u);
  await assert.rejects(() => registerBip39Wordlist('edge-list', ['x'], '0'.repeat(64), webcrypto), /2048/u);
  const invalidWords = Array.from({ length: 2048 }, (_, index) => `word${index}`);
  invalidWords[4] = '';
  await assert.rejects(() => registerBip39Wordlist('edge-list', invalidWords, sha(invalidWords), webcrypto), /NFKD/u);
  assert.equal(getBip39WordlistStatus('edge-list').state, 'idle');
  assert.throws(() => generateMnemonicFromEntropy('not-bytes'), /Uint8Array/u);
  assert.throws(() => generateMnemonicFromEntropy(new Uint8Array(15)), /entropy bits/u);
  assert.throws(() => generateMnemonicFromEntropy(new Uint8Array(16), 'not-ready'), /not ready/u);
  assert.throws(() => generateMnemonic({ entropyBits: 129 }, fixedCrypto()), /entropy bits/u);
  assert.equal(validateMnemonic('not a mnemonic', 'edge-list'), false);
});

test('Passphrase 独立词包拒绝重复、漂移、未注册与越界有效池', async () => {
  assert.throws(() => getPassphrasePackStatus('Bad ID'), /pack id/u);
  assert.throws(() => getPassphrasePack('missing-pack'), /not ready/u);
  await assert.rejects(() => registerPassphrasePack(null, webcrypto), /object/u);
  await assert.rejects(() => registerPassphrasePack({ id: 'edge-pack', version: '', words: ['a'], sha256: sha(['a']) }, webcrypto), /version/u);
  await assert.rejects(() => registerPassphrasePack({ id: 'edge-pack', version: '1', words: [], sha256: sha([]) }, webcrypto), /contain words/u);
  await assert.rejects(() => registerPassphrasePack({ id: 'edge-pack', version: '1', words: [' a'], sha256: sha([' a']) }, webcrypto), /word 0/u);
  await assert.rejects(() => registerPassphrasePack({ id: 'edge-pack', version: '1', words: ['a', 'a'], sha256: sha(['a', 'a']) }, webcrypto), /unique/u);

  const words = ['alpha', 'beta'];
  await registerPassphrasePack({ id: 'edge-pack', version: '1', words, sha256: sha(words) }, webcrypto);
  await assert.rejects(() => createPassphraseProvenance('edge-pack', ['gamma'], webcrypto), /subset/u);
  const changed = ['alpha', 'gamma'];
  await assert.rejects(() => registerPassphrasePack({ id: 'edge-pack', version: '2', words: changed, sha256: sha(changed) }, webcrypto), /already registered/u);
});

test('概率契约覆盖归一化、科学计数与无效格式分支', () => {
  assert.deepEqual(normalizeSearchSpace(3n), { kind: 'integer', value: 3n });
  assert.deepEqual(normalizeSearchSpace({ kind: 'integer', value: 4n }), { kind: 'integer', value: 4n });
  assert.equal(probabilityBits({ kind: 'integer', value: 8n }), 3);
  assert.throws(() => normalizeSearchSpace(null), /searchSpace/u);
  assert.throws(() => normalizeSearchSpace([]), /searchSpace/u);
  assert.throws(() => normalizeSearchSpace({ kind: 'decimal' }), /unsupported/u);
  assert.equal(formatSearchSpace(createIntegerSearchSpace(10n ** 20n)), '1.000e+20');
  assert.throws(() => formatExpectedRank(null), /object/u);
  assert.throws(() => formatExpectedRank({ kind: 'rational', numerator: 3n, denominator: 3n }), /supported/u);
  assert.equal(expectedRankForSearchSpace(1n).bits, 0);
});

test('Random Bytes 对编码、摘要与 materialize 边界 fail closed', async () => {
  await assert.rejects(() => generateLazyRandomBytes(null, fixedCrypto()), /config/u);
  await assert.rejects(() => generateLazyRandomBytes({ byteLength: 0 }, fixedCrypto()), /byteLength/u);
  await assert.rejects(() => generateLazyRandomBytes({ encoding: 'utf8' }, fixedCrypto()), /encoding/u);
  await assert.rejects(() => generateLazyRandomBytes({ uppercase: 'yes' }, fixedCrypto()), /uppercase/u);
  await assert.rejects(() => generateLazyRandomBytes({ byteLength: 4 }, { getRandomValues: fixedCrypto().getRandomValues }), /subtle\.digest/u);

  const result = await generateLazyRandomBytes({ byteLength: 3, encoding: 'base64url', uppercase: true }, fixedCrypto(0xfb));
  assert.doesNotMatch(result.preview, /=/u);
  assert.throws(() => materializeRandomBytes(null), /Random Bytes/u);
  assert.throws(() => materializeRandomBytes(result, 'utf8'), /encoding/u);
});

test('预算、结果模型与安全评估覆盖拒绝和默认分支', () => {
  assert.throws(() => assertClipboardBudget(-1), /non-negative/u);
  assert.throws(() => assertClipboardBudget(4 * 1024 * 1024 + 1), /4 MiB/u);
  assert.throws(() => createHistoryBudget({ maxEntries: 0, estimateBytes() {}, clearEntry() {} }), /positive/u);
  assert.throws(() => createHistoryBudget({ maxBytes: 1 }), /functions/u);
  assert.equal(estimateResultRetentionBytes(null), 0);
  assert.equal(estimateResultRetentionBytes({ bytes: Uint8Array.of(1), value: 'ab', preview: 'c' }), 7);

  assert.throws(() => createGenerationResult(), /type/u);
  assert.throws(() => createGenerationResult({
    type: 'unknown', schemeId: 'x', value: '', configSnapshot: {}, generationModel: generationModel(),
  }), /unsupported/u);
  assert.throws(() => createGenerationResult({
    type: 'password', schemeId: 'x', value: '', bytes: [], configSnapshot: {}, generationModel: generationModel(),
  }), /Uint8Array/u);
  assert.throws(() => createGenerationResult({
    type: 'password', schemeId: 'x', value: '', configSnapshot: {}, generationModel: generationModel('password', { generatorMinEntropyBits: -1 }),
  }), /non-negative/u);

  assert.throws(() => createSecurityAssessment(), /required/u);
  assert.throws(() => createSecurityAssessment({ generationModel: generationModel('other') }), /unsupported/u);
  const idle = createSecurityAssessment({ generationModel: generationModel('passphrase') });
  assert.equal(idle.observedPattern.status, 'idle');
  const pin = createSecurityAssessment({ generationModel: generationModel('pin') });
  assert.equal(pin.attackScenarios.length, 1);
});

test('模式分析协调器覆盖未就绪、兼容字段、BigInt 和参数拒绝分支', async () => {
  const idle = createPatternAnalysisCoordinator();
  assert.equal(idle.ready, false);
  assert.equal(await idle.analyze([], { epoch: 1, isLive() { return true; }, onUpdate() {} }), false);
  assert.throws(() => idle.analyze(null, { epoch: 1, isLive() {}, onUpdate() {} }), /array/u);
  assert.throws(() => idle.analyze([], { epoch: 1, isLive: null, onUpdate() {} }), /functions/u);
  assert.throws(() => idle.setAnalyzer(null), /function/u);

  const updates = [];
  const coordinator = createPatternAnalysisCoordinator({
    analyze: async (value) => value === 'big'
      ? { patternGuesses: 1n << 80n, patterns: ['dictionary', 'bruteforce', 'dictionary'] }
      : { patternGuesses: 'invalid', sequence: [{ pattern: 'repeat' }] },
  });
  await coordinator.analyze([
    { id: 'skip', type: 'uuid', value: 'skip' },
    { id: 'big', type: 'password', value: 'big' },
    { id: 'invalid', type: 'passphrase', value: 'invalid' },
  ], {
    epoch: 2,
    isLive: () => true,
    onUpdate: (id, result) => updates.push([id, result]),
  });
  assert.equal(updates[0][1].guessBits, 80);
  assert.deepEqual(updates[0][1].sequences, ['dictionary']);
  assert.equal(updates[1][1].guessBits, null);
});
