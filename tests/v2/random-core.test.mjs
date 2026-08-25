import test from 'node:test';
import assert from 'node:assert/strict';

import {
  secureBigIntBelow,
  secureInt,
  secureRandomBytes,
  secureShuffle,
  weightedBigIntChoice,
} from '../../src/v2/random-core.mjs';

function queuedCrypto(chunks) {
  const queue = [...chunks];
  return {
    getRandomValues(target) {
      const chunk = queue.shift();
      assert.ok(chunk, 'deterministic random queue was exhausted');
      assert.ok(chunk.length >= target.length, 'queued chunk is shorter than the requested target');
      target.set(chunk.subarray(0, target.length));
      return target;
    },
  };
}

test('secureRandomBytes returns a fresh Uint8Array filled by Web Crypto', () => {
  const source = Uint8Array.of(1, 2, 3);
  const value = secureRandomBytes(3, queuedCrypto([source]));

  assert.deepEqual([...value], [1, 2, 3]);
  assert.notEqual(value, source);
});

test('secureRandomBytes chunks requests above the Web Crypto per-call limit', () => {
  const requestedLengths = [];
  const cryptoLike = {
    getRandomValues(target) {
      requestedLengths.push(target.length);
      target.fill(requestedLengths.length);
      return target;
    },
  };

  const value = secureRandomBytes(65_537, cryptoLike);

  assert.deepEqual(requestedLengths, [65_536, 1]);
  assert.equal(value[0], 1);
  assert.equal(value.at(-1), 2);
});

test('secureRandomBytes rejects invalid lengths and unavailable Web Crypto', () => {
  assert.throws(() => secureRandomBytes('3', {}), TypeError);
  assert.throws(() => secureRandomBytes(1.5, {}), RangeError);
  assert.throws(() => secureRandomBytes(0, {}), RangeError);
  assert.throws(() => secureRandomBytes(-1, {}), RangeError);
  assert.throws(() => secureRandomBytes(1, null), /Web Crypto/);
});

test('secureInt rejects the biased tail', () => {
  const cryptoLike = queuedCrypto([Uint8Array.of(255), Uint8Array.of(4)]);
  assert.equal(secureInt(10, cryptoLike), 4);
});

test('secureInt accepts the full safe-integer range without Number rounding', () => {
  const cryptoLike = queuedCrypto([new Uint8Array(7)]);
  assert.equal(secureInt(Number.MAX_SAFE_INTEGER, cryptoLike), 0);
});

test('secureInt rejects invalid bounds', () => {
  assert.throws(() => secureInt(2n, {}), TypeError);
  assert.throws(() => secureInt(1.25, {}), RangeError);
  assert.throws(() => secureInt(0, {}), RangeError);
  assert.throws(() => secureInt(Number.MAX_SAFE_INTEGER + 1, {}), RangeError);
});

test('secureBigIntBelow rejects values outside a non-power-of-two bound', () => {
  const cryptoLike = queuedCrypto([Uint8Array.of(255), Uint8Array.of(16)]);
  assert.equal(secureBigIntBelow(17n, cryptoLike), 16n);
});

test('secureBigIntBelow includes the largest value below a power-of-two bound', () => {
  const cryptoLike = queuedCrypto([Uint8Array.of(255)]);
  assert.equal(secureBigIntBelow(256n, cryptoLike), 255n);
});

test('secureBigIntBelow returns the only valid value for a bound of one', () => {
  const cryptoLike = {
    getRandomValues() {
      assert.fail('a single-outcome draw must not consume random bytes');
    },
  };
  assert.equal(secureBigIntBelow(1n, cryptoLike), 0n);
});

test('secureBigIntBelow rejects non-BigInt and non-positive bounds', () => {
  assert.throws(() => secureBigIntBelow(10, {}), TypeError);
  assert.throws(() => secureBigIntBelow(0n, {}), RangeError);
  assert.throws(() => secureBigIntBelow(-1n, {}), RangeError);
});

test('weightedBigIntChoice maps the draw to cumulative exact weights', () => {
  const cryptoLike = queuedCrypto([Uint8Array.of(5)]);
  assert.equal(weightedBigIntChoice(['a', 'b'], [5n, 3n], cryptoLike), 'b');
});

test('weightedBigIntChoice skips zero-weight entries', () => {
  const cryptoLike = queuedCrypto([Uint8Array.of(0)]);
  assert.equal(weightedBigIntChoice(['never', 'always'], [0n, 2n], cryptoLike), 'always');
});

test('weightedBigIntChoice rejects malformed or unsafe weights', () => {
  assert.throws(() => weightedBigIntChoice('ab', [1n, 1n], {}), TypeError);
  assert.throws(() => weightedBigIntChoice([], [], {}), RangeError);
  assert.throws(() => weightedBigIntChoice(['a'], [1n, 2n], {}), RangeError);
  assert.throws(() => weightedBigIntChoice(['a'], [1], {}), TypeError);
  assert.throws(() => weightedBigIntChoice(['a'], [-1n], {}), RangeError);
  assert.throws(() => weightedBigIntChoice(['a', 'b'], [0n, 0n], {}), RangeError);
});

test('secureShuffle performs an unbiased Fisher-Yates shuffle without mutating the input', () => {
  const source = ['a', 'b', 'c'];
  const cryptoLike = queuedCrypto([Uint8Array.of(2), Uint8Array.of(0)]);

  assert.deepEqual(secureShuffle(source, cryptoLike), ['b', 'a', 'c']);
  assert.deepEqual(source, ['a', 'b', 'c']);
});

test('secureShuffle rejects non-array input', () => {
  assert.throws(() => secureShuffle('abc', {}), TypeError);
});
