import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { compileGenerator } from '../../src/v201/compiled-generators.mjs';
import { generateAtomicBatch } from '../../src/v201/batch-generator.mjs';
import { clearGenerationResult } from '../../src/v201/result-model.mjs';
import { createPatternAnalysisCoordinator } from '../../src/v201/zxcvbn-coordinator.mjs';

test('UUID v4/v7 在模型升级后保留版本、变体和时间戳', async () => {
  for (const version of [4, 7]) {
    const generator = await compileGenerator('uuid', { version }, { cryptoLike: webcrypto });
    const [result] = await generator.sampleBatch(1);
    assert.equal(result.generationModel.version, version);
    assert.equal(result.generationModel.variant, '10');
    assert.equal(result.generationModel.timestampUnixMs, version === 7 ? result.configSnapshot.timestampUnixMs : null);
  }
});

test('口令模型保留词数及随机大小写、分隔符契约，不带生成词语', async () => {
  const generator = await compileGenerator('passphrase', {
    wordCount: 3, words: ['alpha', 'beta', 'gamma'], capitalization: 'random-uppercase', separator: 'random-digit',
  }, { cryptoLike: webcrypto });
  const [result] = await generator.sampleBatch(1);
  assert.equal(result.generationModel.wordCount, 3);
  assert.equal(result.generationModel.capitalization, 'random-uppercase');
  assert.equal(result.generationModel.separatorChoicesPerGap, 10);
  assert.equal(result.generationModel.separatorGapCount, 2);
  assert.equal(Object.isFrozen(result.generationModel), true);
  assert.equal('words' in result.generationModel, false);
});

test('PIN 独立批次与单条都有明确碰撞概率，不把缺失数据视为零', async () => {
  const generator = await compileGenerator('pin', {
    length: 4, allowLeadingZero: true, allowRepeated: true, limitSequential: false, blockWeak: false, uniqueWithinBatch: false,
  }, { cryptoLike: webcrypto });
  const batch = await generator.sampleBatch(100);
  assert.ok(Math.abs(batch[0].generationModel.independentBatchCollisionProbability - 0.3914340350427218) < 1e-12);
  assert.equal(batch.every(result => result.generationModel.independentBatchCollisionProbability === batch[0].generationModel.independentBatchCollisionProbability), true);
  assert.equal((await generator.sampleOne()).generationModel.independentBatchCollisionProbability, 0);
});

test('随机字节顺序批次失败会清理所有成功结果，不遗留在途摘要', async () => {
  const raw = [];
  let calls = 0;
  const cryptoLike = {
    getRandomValues(bytes) { bytes.fill(7); raw.push(bytes); return bytes; },
    subtle: { async digest(...args) {
      if (++calls === 2) throw new Error('test digest failure');
      return webcrypto.subtle.digest(...args);
    } },
  };
  const job = { id: 1, mode: 'randomBytes', config: { byteLength: 32, encoding: 'hex' }, quantity: 3 };
  await assert.rejects(generateAtomicBatch({
    job, isCurrent: () => true, clearResult: clearGenerationResult,
    compile: (mode, config) => compileGenerator(mode, config, { cryptoLike }),
  }), /digest failure/u);
  assert.equal(raw.every(bytes => bytes.every(byte => byte === 0)), true);
  assert.equal(calls, 2, '失败后不再启动第三条');
});

test('顺序批次拒绝无效数量，避免 Infinity 或超大数量循环', async () => {
  const generator = await compileGenerator('token', { byteLength: 16 }, { cryptoLike: webcrypto });
  for (const quantity of [0, -1, 1.5, Infinity, NaN, 101]) await assert.rejects(generator.sampleBatch(quantity), /quantity/u);
});

test('PIN 唯一与独立批次都在采样前拒绝超限数量', async () => {
  for (const uniqueWithinBatch of [true, false]) {
    const generator = await compileGenerator('pin', {
      length: 4, allowLeadingZero: true, allowRepeated: true, limitSequential: false, blockWeak: false, uniqueWithinBatch,
    }, { cryptoLike: webcrypto });
    for (const quantity of [101, 0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(generator.sampleBatch(quantity), /quantity/u);
    }
  }
});

test('同步采样异常也清理已生成的原始字节，并停止启动后续采样', async () => {
  const raw = [];
  const cryptoLike = { getRandomValues(bytes) {
    if (raw.length === 1) throw new Error('random source failed');
    bytes.fill(9); raw.push(bytes); return bytes;
  } };
  const generator = await compileGenerator('token', { byteLength: 16, encoding: 'hex' }, { cryptoLike });
  await assert.rejects(async () => generator.sampleBatch(3), /random source failed/u);
  assert.equal(raw.every(bytes => bytes.every(byte => byte === 0)), true);
});

test('模式分析单条失败标为失败并继续，已删除结果不再交给分析器', async () => {
  const seen = []; const updates = new Map();
  const coordinator = createPatternAnalysisCoordinator({ analyze: async value => {
    seen.push(value);
    if (value === 'bad') throw new Error('failure containing secret');
    return { patternGuesses: 16, sequence: [] };
  } });
  await coordinator.analyze(['bad', 'gone', 'good'].map(id => ({ id, type: 'password', value: id })), {
    epoch: 1, isLive: id => id !== 'gone', onUpdate: (id, value) => updates.set(id, value),
  });
  assert.deepEqual(seen, ['bad', 'good']);
  assert.equal(updates.get('bad').status, 'error');
  assert.equal(updates.get('good').status, 'ready');
  assert.equal(JSON.stringify([...updates]).includes('failure containing secret'), false);
});
