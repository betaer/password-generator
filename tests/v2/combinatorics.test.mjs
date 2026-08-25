import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseBigInt,
  factorialBigInt,
  fallingFactorialBigInt,
  formatBigIntScientific,
  log2BigInt,
} from '../../src/v2/combinatorics.mjs';

test('factorialBigInt returns memoized exact factorial values', () => {
  assert.equal(factorialBigInt(0), 1n);
  assert.equal(factorialBigInt(1), 1n);
  assert.equal(factorialBigInt(20), 2_432_902_008_176_640_000n);
  assert.equal(factorialBigInt(10), 3_628_800n);
});

test('factorialBigInt rejects unsafe, fractional, and negative inputs', () => {
  assert.throws(() => factorialBigInt(3n), TypeError);
  assert.throws(() => factorialBigInt(1.5), RangeError);
  assert.throws(() => factorialBigInt(-1), RangeError);
  assert.throws(() => factorialBigInt(Number.MAX_SAFE_INTEGER + 1), RangeError);
});

test('chooseBigInt computes exact combinations and symmetric branches', () => {
  assert.equal(chooseBigInt(52, 5), 2_598_960n);
  assert.equal(chooseBigInt(52, 47), 2_598_960n);
  assert.equal(chooseBigInt(5, 0), 1n);
  assert.equal(chooseBigInt(5, 6), 0n);
  assert.equal(chooseBigInt(5, -1), 0n);
});

test('chooseBigInt validates both arguments', () => {
  assert.throws(() => chooseBigInt('5', 2), TypeError);
  assert.throws(() => chooseBigInt(5, 2n), TypeError);
  assert.throws(() => chooseBigInt(-1, 0), RangeError);
  assert.throws(() => chooseBigInt(5, 1.5), RangeError);
});

test('fallingFactorialBigInt computes exact ordered selections', () => {
  assert.equal(fallingFactorialBigInt(10, 3), 720n);
  assert.equal(fallingFactorialBigInt(10, 0), 1n);
  assert.equal(fallingFactorialBigInt(3, 4), 0n);
  assert.equal(fallingFactorialBigInt(3, -1), 0n);
});

test('fallingFactorialBigInt validates both arguments', () => {
  assert.throws(() => fallingFactorialBigInt({}, 1), TypeError);
  assert.throws(() => fallingFactorialBigInt(3, '1'), TypeError);
  assert.throws(() => fallingFactorialBigInt(-1, 0), RangeError);
  assert.throws(() => fallingFactorialBigInt(3, 1.5), RangeError);
});

test('log2BigInt remains finite and accurate for huge exact integers', () => {
  assert.equal(log2BigInt(1n), 0);
  assert.equal(log2BigInt(1n << 4096n), 4096);
  assert.ok(Math.abs(log2BigInt(3n) - Math.log2(3)) < Number.EPSILON);
});

test('log2BigInt rejects non-BigInt and non-positive values', () => {
  assert.throws(() => log2BigInt(2), TypeError);
  assert.throws(() => log2BigInt(0n), RangeError);
  assert.throws(() => log2BigInt(-1n), RangeError);
});

test('formatBigIntScientific formats and rounds without Number overflow', () => {
  assert.equal(formatBigIntScientific(0n), '0');
  assert.equal(formatBigIntScientific(123_456_789n), '1.23e+8');
  assert.equal(formatBigIntScientific(9_995n, 3), '1.00e+4');
  assert.equal(formatBigIntScientific(-123_456n, 4), '-1.235e+5');
  assert.equal(formatBigIntScientific(1n << 4096n, 5).endsWith('e+1233'), true);
  assert.equal(formatBigIntScientific(12n, 4), '1.200e+1');
});

test('formatBigIntScientific validates value and significant digits', () => {
  assert.throws(() => formatBigIntScientific(1), TypeError);
  assert.throws(() => formatBigIntScientific(1n, 0), RangeError);
  assert.throws(() => formatBigIntScientific(1n, 1.5), RangeError);
  assert.throws(() => formatBigIntScientific(1n, 101), RangeError);
});
