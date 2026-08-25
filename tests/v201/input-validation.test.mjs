import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePrintableAscii,
  normalizeOptionalPrintableAscii,
} from '../../src/v201/input-validation.mjs';

test('自定义符号只接受限定长度的 printable ASCII', () => {
  assert.equal(normalizePrintableAscii('!@#?', '符号池', 64), '!@#?');
  assert.throws(() => normalizePrintableAscii('', '符号池', 64), /不能为空/);
  assert.throws(() => normalizePrintableAscii('a\n', '符号池', 64), /printable ASCII/);
  assert.throws(() => normalizePrintableAscii('👨‍👩‍👧‍👦', '符号池', 64), /printable ASCII/);
  assert.throws(() => normalizePrintableAscii('!'.repeat(65), '符号池', 64), /64/);
});

test('前缀等可选字段允许空值但拒绝控制字符与超长输入', () => {
  assert.equal(normalizeOptionalPrintableAscii('', '前缀', 64), '');
  assert.equal(normalizeOptionalPrintableAscii('demo_test_', '前缀', 64), 'demo_test_');
  assert.throws(() => normalizeOptionalPrintableAscii('\u202eabc', '前缀', 64), /printable ASCII/);
});
