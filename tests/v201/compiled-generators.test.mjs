import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { compileGenerator } from '../../src/v201/compiled-generators.mjs';

test('Password 编译一次后可复用同一模型生成整批', async () => {
  const compiled = await compileGenerator('password', {
    length: 16,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    symbolPool: '!@#',
    requireEach: true,
    allowRepeated: true,
    symbolRatioRange: [10, 35],
  }, { cryptoLike: webcrypto });
  const model = compiled.model;
  const batch = await compiled.sampleBatch(4);

  assert.equal(batch.length, 4);
  assert.equal(compiled.model, model);
  assert.equal(batch.every((result) => result.generationModel.searchSpace.value === model.searchSpace), true);
  assert.equal(batch.every((result) => result.generationModel.presentationProfile === 'password'), true);
  assert.equal(batch.every((result) => !('sourceEntropyBits' in result.generationModel)), true);
});

test('PIN quantity>1 默认 exact 无放回并记录碰撞概率', async () => {
  const compiled = await compileGenerator('pin', {
    length: 4,
    allowLeadingZero: true,
    allowRepeated: true,
    limitSequential: false,
    blockWeak: false,
    uniqueWithinBatch: true,
  }, { cryptoLike: webcrypto });
  const batch = await compiled.sampleBatch(100);

  assert.equal(new Set(batch.map(({ value }) => value)).size, 100);
  assert.equal(batch.every((result) => result.configSnapshot.uniqueWithinBatch === true), true);
  assert.ok(batch[0].generationModel.independentBatchCollisionProbability > 0.39);
});

test('UUID、Token 与 Hex 都升级为 V2.0.1 专用 profile', async () => {
  for (const [mode, config, profile] of [
    ['uuid', { version: 4 }, 'uuid'],
    ['token', { byteLength: 16, encoding: 'hex', prefix: 'tok_' }, 'token'],
    ['hex', { byteLength: 16, prefix: true }, 'hex'],
  ]) {
    const compiled = await compileGenerator(mode, config, { cryptoLike: webcrypto });
    const [result] = await compiled.sampleBatch(1);
    assert.equal(result.generationModel.presentationProfile, profile);
    assert.equal(result.schemaVersion, '2.0.1');
  }
});

test('Random Bytes 编译器使用延迟编码结果', async () => {
  const compiled = await compileGenerator('randomBytes', {
    byteLength: 1024 * 1024,
    encoding: 'hex',
  }, { cryptoLike: webcrypto });
  const [result] = await compiled.sampleBatch(1);
  assert.equal(result.value, '');
  assert.equal(result.preview.length < 200, true);
  assert.equal(result.generationModel.searchSpace.exponent, 8_388_608);
});

