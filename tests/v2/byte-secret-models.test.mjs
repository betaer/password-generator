import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeBase64Url,
  decodeHex,
  encodeBase64,
  encodeBase64Url,
  encodeHex,
} from '../../src/v2/encoders.mjs';
import {
  createBinaryDownload,
  formatExistingBytes,
  generateApiSecret,
  generateHex,
  generateRandomBytes,
  generateToken,
} from '../../src/v2/byte-secret-models.mjs';
import { clearGenerationResult } from '../../src/v2/result-model.mjs';

function queuedCrypto(chunks) {
  const queue = chunks.map((chunk) => Uint8Array.from(chunk));
  return {
    getRandomValues(target) {
      const chunk = queue.shift();
      assert.ok(chunk, 'unexpected getRandomValues call');
      assert.equal(chunk.length, target.length);
      target.set(chunk);
      return target;
    },
    remaining() {
      return queue.length;
    },
  };
}

const fixedCrypto = {
  getRandomValues(target) {
    target.fill(0xab);
    return target;
  },
};

test('Hex、Base64 与 Base64URL 编码符合已知字节向量', () => {
  const bytes = Uint8Array.of(0xfb, 0xef, 0xff);
  assert.equal(encodeHex(bytes), 'fbefff');
  assert.equal(encodeHex(bytes, true), 'FBEFFF');
  assert.equal(encodeBase64(bytes), '++//');
  assert.equal(encodeBase64Url(bytes), '--__');
  assert.deepEqual([...decodeHex('0xFBEFFF')], [...bytes]);
  assert.deepEqual([...decodeBase64Url('--__')], [...bytes]);
});

test('Base64URL 正确保留或移除 padding 并能往返解码', () => {
  const bytes = Uint8Array.of(0xff);
  assert.equal(encodeBase64Url(bytes, true), '_w==');
  assert.equal(encodeBase64Url(bytes, false), '_w');
  assert.deepEqual([...decodeBase64Url('_w==')], [0xff]);
  assert.deepEqual([...decodeBase64Url('_w')], [0xff]);
});

test('解码器拒绝奇数 Hex、非法字符和非法 Base64URL padding', () => {
  assert.throws(() => decodeHex('abc'), RangeError);
  assert.throws(() => decodeHex('zz'), TypeError);
  assert.throws(() => decodeBase64Url('a+b/'), TypeError);
  assert.throws(() => decodeBase64Url('a==='), TypeError);
  assert.throws(() => decodeBase64Url('ab='), TypeError);
});

test('编码器对类型错误和运行时 Base64 API 失败给出明确异常', () => {
  assert.throws(() => encodeHex([1, 2]), TypeError);
  assert.throws(() => encodeHex(Uint8Array.of(1), 'yes'), TypeError);
  assert.throws(() => decodeHex(null), TypeError);
  assert.throws(() => encodeBase64Url(Uint8Array.of(1), 'no'), TypeError);
  assert.throws(() => decodeBase64Url(null), TypeError);

  const originalAtob = globalThis.atob;
  try {
    globalThis.atob = () => { throw new Error('decoder unavailable'); };
    assert.throws(() => decodeBase64Url('_w'), TypeError);
  } finally {
    globalThis.atob = originalAtob;
  }
});

test('Token、Hex 与 Random Bytes 的强度严格等于随机字节数乘八', () => {
  for (const generate of [generateToken, generateHex, generateRandomBytes]) {
    const result = generate({ byteLength: 32, encoding: 'hex' }, fixedCrypto);
    assert.equal(result.generationModel.sourceEntropyBits, 256);
    assert.equal(result.generationModel.minEntropyBits, 256);
    assert.equal(result.generationModel.shannonEntropyBits, 256);
    assert.equal(result.generationModel.randomByteLength, 32);
    assert.equal(result.generationModel.searchSpace, 1n << 256n);
  }
});

test('固定 Token 与 API Secret 前缀不会增加熵', () => {
  const token = generateToken(
    { byteLength: 16, encoding: 'base64url-nopad', prefix: 'tok_' },
    fixedCrypto,
  );
  const secret = generateApiSecret(
    { byteLength: 16, encoding: 'base64url-nopad', prefix: 'sk_test_' },
    fixedCrypto,
  );

  assert.ok(token.value.startsWith('tok_'));
  assert.ok(secret.value.startsWith('sk_test_'));
  assert.equal(token.generationModel.minEntropyBits, 128);
  assert.equal(secret.generationModel.minEntropyBits, 128);
  assert.equal(secret.generationModel.prefix, 'sk_test_');
});

test('API Secret 的环境和版本字段属于确定性前缀', () => {
  const result = generateApiSecret(
    {
      byteLength: 1,
      encoding: 'hex',
      prefix: 'sk_',
      environment: 'live',
      version: 'v2',
      template: 'stripe-like',
    },
    queuedCrypto([[0xff]]),
  );
  assert.equal(result.value, 'sk_live_v2_ff');
  assert.equal(result.generationModel.minEntropyBits, 8);
  assert.equal(result.configSnapshot.testOnlyAppearance, true);
  assert.match(result.generationModel.standard, /Test-only/u);
});

test('可选 Key ID 与 Secret 使用独立随机字节和独立结果字段', () => {
  const cryptoLike = queuedCrypto([
    [0x01, 0x02, 0x03, 0x04],
    [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x10, 0x20],
  ]);
  const result = generateApiSecret(
    {
      byteLength: 8,
      encoding: 'hex',
      prefix: 'sk_live_',
      keyId: { byteLength: 4, encoding: 'hex', prefix: 'kid_' },
    },
    cryptoLike,
  );

  assert.equal(result.keyId.value, 'kid_01020304');
  assert.equal(result.value, 'sk_live_aabbccddeeff1020');
  assert.notStrictEqual(result.keyId.bytes, result.bytes);
  assert.equal(result.keyId.generationModel.minEntropyBits, 32);
  assert.equal(result.generationModel.minEntropyBits, 64);
  assert.deepEqual(result.fields, {
    keyId: 'kid_01020304',
    secret: 'sk_live_aabbccddeeff1020',
  });
  assert.equal(cryptoLike.remaining(), 0);
});

test('清除复合 API Secret 会同时覆盖 Secret 与 Key ID 的可变字节', () => {
  const result = generateApiSecret(
    {
      byteLength: 2,
      encoding: 'hex',
      keyId: { byteLength: 2, encoding: 'hex' },
    },
    queuedCrypto([[1, 2], [3, 4]]),
  );
  const secretBytes = result.bytes;
  const keyIdBytes = result.keyId.bytes;

  assert.equal(clearGenerationResult(result), null);
  assert.deepEqual([...secretBytes], [0, 0]);
  assert.deepEqual([...keyIdBytes], [0, 0]);
});

test('Hex 支持大写与 0x 前缀且格式字段不增加熵', () => {
  const result = generateHex(
    { byteLength: 2, uppercase: true, prefix: true },
    queuedCrypto([[0x0a, 0xbc]]),
  );
  assert.equal(result.value, '0x0ABC');
  assert.equal(result.generationModel.minEntropyBits, 16);
  assert.equal(result.generationModel.prefix, '0x');
  assert.equal(result.generationModel.alphabet, '0123456789ABCDEF');
});

test('同一批 Random Bytes 可切换编码而不重新取随机数', () => {
  const result = generateRandomBytes(
    { byteLength: 3, encoding: 'hex' },
    queuedCrypto([[0xfb, 0xef, 0xff]]),
  );
  assert.equal(result.value, 'fbefff');
  assert.equal(formatExistingBytes(result.bytes, 'base64'), '++//');
  assert.equal(formatExistingBytes(result.bytes, 'base64url-nopad'), '--__');
  assert.equal(formatExistingBytes(result.bytes, 'hex', { uppercase: true }), 'FBEFFF');
});

test('字节模型拒绝超出范围的长度和未知编码', () => {
  assert.throws(() => generateToken({ byteLength: 0, encoding: 'hex' }, fixedCrypto), RangeError);
  assert.throws(() => generateToken({ byteLength: '4', encoding: 'hex' }, fixedCrypto), TypeError);
  assert.throws(() => generateHex({ byteLength: 4097 }, fixedCrypto), RangeError);
  assert.throws(() => generateRandomBytes({ byteLength: 1_048_577 }, fixedCrypto), RangeError);
  assert.throws(() => generateToken({ byteLength: 4, encoding: 'rot13' }, fixedCrypto), RangeError);
  assert.throws(() => generateToken({ byteLength: 4, encoding: 1 }, fixedCrypto), TypeError);
  assert.throws(() => generateToken({ byteLength: 4, prefix: 1 }, fixedCrypto), TypeError);
  assert.throws(() => formatExistingBytes(Uint8Array.of(1), 'rot13'), RangeError);
});

test('字节模型严格验证 config、格式选项和 API Secret 字段', () => {
  for (const generate of [generateToken, generateApiSecret, generateHex, generateRandomBytes]) {
    assert.throws(() => generate(null, fixedCrypto), TypeError);
  }
  assert.throws(() => formatExistingBytes([1], 'hex'), TypeError);
  assert.throws(() => formatExistingBytes(Uint8Array.of(1), 'hex', null), TypeError);
  assert.throws(
    () => formatExistingBytes(Uint8Array.of(1), 'hex', { uppercase: 'yes' }),
    TypeError,
  );
  assert.throws(() => generateApiSecret({ environment: 1 }, fixedCrypto), TypeError);
  assert.throws(() => generateApiSecret({ version: 1 }, fixedCrypto), TypeError);
  assert.throws(() => generateApiSecret({ fieldSeparator: 1 }, fixedCrypto), TypeError);
  assert.throws(() => generateApiSecret({ keyId: null }, fixedCrypto), TypeError);
  assert.doesNotThrow(() => generateApiSecret({ keyId: false }, fixedCrypto));
  assert.throws(() => generateHex({ prefix: 'yes' }, fixedCrypto), TypeError);
});

test('默认配置和测试外观 Hex 方案仍保留真实字节元数据', () => {
  const token = generateToken({}, fixedCrypto);
  const hex = generateHex(
    { byteLength: 32, schemeId: 'wallet-private-key-appearance' },
    fixedCrypto,
  );
  assert.equal(token.generationModel.encoding, 'base64url-nopad');
  assert.equal(token.generationModel.randomByteLength, 32);
  assert.equal(hex.configSnapshot.testOnlyAppearance, true);
  assert.match(hex.generationModel.standard, /Test-only/u);
});

test('二进制下载对象只在显式调用时创建并可幂等撤销 URL', async () => {
  const calls = [];
  const urlApi = {
    createObjectURL(blob) {
      calls.push(['create', blob]);
      return 'blob:test-secret';
    },
    revokeObjectURL(url) {
      calls.push(['revoke', url]);
    },
  };

  const download = createBinaryDownload(Uint8Array.of(1, 2, 3), { urlApi });
  assert.equal(download.url, 'blob:test-secret');
  assert.equal(download.blob.type, 'application/octet-stream');
  assert.deepEqual([...new Uint8Array(await download.blob.arrayBuffer())], [1, 2, 3]);
  download.revoke();
  download.revoke();
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'revoke').length, 1);
});

test('二进制下载 helper 拒绝不可安全创建或撤销的对象', () => {
  const validUrlApi = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  assert.throws(() => createBinaryDownload([1], { urlApi: validUrlApi }), TypeError);
  assert.throws(() => createBinaryDownload(Uint8Array.of(1), null), TypeError);
  assert.throws(
    () => createBinaryDownload(Uint8Array.of(1), { BlobConstructor: 'missing', urlApi: validUrlApi }),
    Error,
  );
  assert.throws(
    () => createBinaryDownload(Uint8Array.of(1), { urlApi: {} }),
    TypeError,
  );
  assert.throws(
    () => createBinaryDownload(Uint8Array.of(1), { urlApi: validUrlApi, mimeType: 1 }),
    TypeError,
  );
});
