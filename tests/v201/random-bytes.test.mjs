import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  generateLazyRandomBytes,
  materializeRandomBytes,
} from '../../src/v201/random-bytes.mjs';

test('1 MiB Random Bytes 不创建完整编码字符串或巨大 BigInt', async () => {
  const result = await generateLazyRandomBytes({ byteLength: 1024 * 1024, encoding: 'hex' }, webcrypto);

  assert.equal(result.value, '');
  assert.equal(result.bytes.byteLength, 1024 * 1024);
  assert.equal(result.generationModel.searchSpace.kind, 'power-of-two');
  assert.equal(result.generationModel.searchSpace.exponent, 8_388_608);
  assert.equal(result.generationModel.nominalCsprngOutputBits, 8_388_608);
  assert.equal(result.generationModel.generatorMinEntropyBits, 8_388_608);
  assert.equal(result.configSnapshot.lazyEncoding, true);
  assert.equal(result.preview.length < 200, true);
  assert.match(result.sha256, /^[0-9a-f]{64}$/u);
});

test('编码只在显式 materialize 时生成并可切换格式', async () => {
  const cryptoLike = {
    subtle: webcrypto.subtle,
    getRandomValues(view) {
      view.set([0xfb, 0xef, 0xff]);
      return view;
    },
  };
  const result = await generateLazyRandomBytes({ byteLength: 3, encoding: 'hex' }, cryptoLike);

  assert.equal(result.value, '');
  assert.equal(materializeRandomBytes(result), 'fbefff');
  assert.equal(materializeRandomBytes(result, 'base64'), '++//');
  assert.equal(materializeRandomBytes(result, 'base64url-nopad'), '--__');
});

test('Random Bytes 使用名义 CSPRNG 位数而不是 sourceEntropyBits', async () => {
  const result = await generateLazyRandomBytes({ byteLength: 32 }, webcrypto);
  assert.equal('sourceEntropyBits' in result.generationModel, false);
  assert.equal(result.generationModel.randomSourceBytesRequested, 32);
  assert.equal(result.generationModel.randomSourceConsumptionModel, 'fixed-byte-request');
  assert.equal(result.generationModel.presentationProfile, 'random-bytes');
});

