import test from 'node:test';
import assert from 'node:assert/strict';

import { generateUuidV4, generateUuidV7 } from '../../src/v2/uuid-model.mjs';

function fixedBytes(values) {
  const bytes = Uint8Array.from(values);
  return {
    getRandomValues(target) {
      assert.equal(target.length, bytes.length);
      target.set(bytes);
      return target;
    },
  };
}

test('UUID v4 符合 RFC 9562 version/variant 位并保留 122 个随机 bits', () => {
  const result = generateUuidV4(
    { hyphens: true, uppercase: false },
    fixedBytes([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0xc8, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
    ]),
  );

  assert.equal(result.value, '00112233-4455-4677-8899-aabbccddeeff');
  assert.equal(result.bytes[6] >>> 4, 4);
  assert.equal(result.bytes[8] >>> 6, 2);
  assert.equal(result.generationModel.minEntropyBits, 122);
  assert.equal(result.generationModel.searchSpace, 1n << 122n);
  assert.equal(result.generationModel.standard, 'RFC 9562 UUIDv4');
});

test('UUID v4 大小写和连字符只改变显示，不增加熵', () => {
  const result = generateUuidV4(
    { hyphens: false, uppercase: true },
    fixedBytes(new Array(16).fill(0xab)),
  );
  assert.match(result.value, /^[0-9A-F]{32}$/);
  assert.equal(result.value.slice(12, 13), '4');
  assert.match(result.value.slice(16, 17), /[89AB]/);
  assert.equal(result.generationModel.minEntropyBits, 122);
});

test('UUID v7 精确编码 48-bit 时间戳、12-bit rand_a 与 62-bit rand_b', () => {
  const result = generateUuidV7(
    { hyphens: true, uppercase: false },
    fixedBytes([0x0c, 0xde, 0x3f, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01]),
    () => 0x0123456789ab,
  );

  assert.equal(result.value, '01234567-89ab-7cde-bf45-6789abcdef01');
  assert.equal(result.bytes[6] >>> 4, 7);
  assert.equal(result.bytes[8] >>> 6, 2);
  assert.equal(result.generationModel.minEntropyBits, 74);
  assert.equal(result.generationModel.shannonEntropyBits, 74);
  assert.equal(result.generationModel.searchSpace, 1n << 74n);
  assert.equal(result.generationModel.timestampBits, 48);
  assert.equal(result.generationModel.randomBits, 74);
  assert.equal(result.generationModel.timestampUnixMs, 0x0123456789ab);
});

test('UUID v7 每次调用使用独立的十个随机字节', () => {
  let calls = 0;
  const cryptoLike = {
    getRandomValues(target) {
      calls += 1;
      assert.equal(target.length, 10);
      target.fill(calls);
      return target;
    },
  };

  const first = generateUuidV7({}, cryptoLike, () => 1_700_000_000_000);
  const second = generateUuidV7({}, cryptoLike, () => 1_700_000_000_000);
  assert.notEqual(first.value, second.value);
  assert.equal(calls, 2);
});

test('UUID v7 拒绝非整数、负数和溢出的 Unix 毫秒时间戳', () => {
  const cryptoLike = fixedBytes(new Array(10).fill(0));
  assert.throws(() => generateUuidV7({}, cryptoLike, () => -1), RangeError);
  assert.throws(() => generateUuidV7({}, cryptoLike, () => 1.5), RangeError);
  assert.throws(() => generateUuidV7({}, cryptoLike, () => 2 ** 48), RangeError);
});

test('UUID 模型严格验证配置和时间依赖', () => {
  const v4Crypto = fixedBytes(new Array(16).fill(0));
  const v7Crypto = fixedBytes(new Array(10).fill(0));
  assert.throws(() => generateUuidV4(null, v4Crypto), TypeError);
  assert.throws(() => generateUuidV4({ hyphens: 'yes' }, v4Crypto), TypeError);
  assert.throws(() => generateUuidV4({ uppercase: 'yes' }, v4Crypto), TypeError);
  assert.throws(() => generateUuidV7({}, v7Crypto, 123), TypeError);
});
