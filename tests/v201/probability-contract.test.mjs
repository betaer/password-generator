import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createIntegerSearchSpace,
  createPowerOfTwoSearchSpace,
  expectedRankForSearchSpace,
  formatExpectedRank,
  formatSearchSpace,
  probabilityBits,
} from '../../src/v201/probability-contract.mjs';

test('均匀有限空间使用精确 (N + 1) / 2 期望次序', () => {
  const cases = [
    [1n, 2n, '1'],
    [2n, 3n, '1.5'],
    [3n, 4n, '2'],
    [10_000n, 10_001n, '5,000.5'],
  ];

  for (const [size, numerator, formatted] of cases) {
    const rank = expectedRankForSearchSpace(createIntegerSearchSpace(size));
    assert.equal(rank.numerator, numerator);
    assert.equal(rank.denominator, 2n);
    assert.equal(formatExpectedRank(rank), formatted);
  }
});

test('2 的幂空间保持符号表达且不创建巨大十进制 BigInt', () => {
  const searchSpace = createPowerOfTwoSearchSpace(8_388_608);
  assert.deepEqual(searchSpace, { kind: 'power-of-two', exponent: 8_388_608 });
  assert.equal(formatSearchSpace(searchSpace), '2^8,388,608');
  assert.equal(probabilityBits(searchSpace), 8_388_608);

  const rank = expectedRankForSearchSpace(searchSpace);
  assert.equal(rank.kind, 'symbolic-power-of-two');
  assert.equal(rank.exponent, 8_388_608);
  assert.match(formatExpectedRank(rank), /\(2\^8,388,608 \+ 1\) \/ 2/u);
});

test('小型 2 的幂空间仍能转换为精确整数期望次序', () => {
  const rank = expectedRankForSearchSpace(createPowerOfTwoSearchSpace(8));
  assert.equal(rank.numerator, 257n);
  assert.equal(rank.denominator, 2n);
  assert.equal(rank.bits, Math.log2(257) - 1);
});

test('搜索空间拒绝零、负数、非整数和危险指数', () => {
  assert.throws(() => createIntegerSearchSpace(0n), RangeError);
  assert.throws(() => createIntegerSearchSpace(2), TypeError);
  assert.throws(() => createPowerOfTwoSearchSpace(-1), RangeError);
  assert.throws(() => createPowerOfTwoSearchSpace(1.5), TypeError);
});

