# Password Generator V2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete `index-2.0.html` that generates nine kinds of security-sensitive random data, uses the same exact probability model for constrained sampling and entropy, separates Generate from Copy, defaults History off, masks secrets in the DOM, and isolates Google Analytics in a sandbox iframe.

**Architecture:** Keep V1.7.5 `index.html` unchanged as the stable entry. Add pure, testable V2 generation modules under `src/v2/`, bundle them to same-origin IIFE assets under `assets/v2/`, and wire a V2-specific application copied from the current page. Every generated result carries immutable model metadata; the UI never reconstructs generator entropy from the visible string.

**Tech Stack:** Static HTML, React and Ant Design already embedded in the existing page, JavaScript ESM source modules, Node test runner, c8 coverage, esbuild, Playwright, Web Crypto, `@scure/bip39` 2.3.0, zxcvbn-ts, GitHub Pages.

---

## Scope organization

The approved specification spans probability math, nine generators, browser privacy, analytics isolation, UI, documentation, and release validation. The user explicitly requested one complete V2.0 delivery, so this plan keeps one release while making every task independently testable and independently committed.

## File responsibility map

| Path | Responsibility |
|---|---|
| `index.html` | Unmodified V1.7.5 stable entry |
| `index-2.0.html` | V2.0 UI shell and React application |
| `src/v2/random-core.mjs` | Web Crypto bytes, unbiased integers, BigInt rejection sampling, weighted choice |
| `src/v2/combinatorics.mjs` | BigInt factorials, combinations, falling factorials, stable log2 formatting |
| `src/v2/result-model.mjs` | Immutable GenerationResult and safe byte cleanup |
| `src/v2/password-model.mjs` | Exact constrained Password counting and uniform sampling |
| `src/v2/passphrase-model.mjs` | Word, capitalization, and separator probability model |
| `src/v2/pin-model.mjs` | PIN constraint DP, weak-pattern exclusion, uniform sampling |
| `src/v2/encoders.mjs` | Hex, Base64, Base64URL, UTF-safe formatting |
| `src/v2/byte-secret-models.mjs` | Token, API Secret, Hex, Random Bytes |
| `src/v2/uuid-model.mjs` | RFC 9562 UUID v4 and v7 |
| `src/v2/bip39-model.mjs` | BIP39 entropy, checksum, language registry, validation |
| `src/v2/security-assessment.mjs` | Generator metrics, pattern overlay, levels, attack times, resource states |
| `src/v2/runtime-entry.mjs` | Browser-facing frozen V2 runtime API |
| `src/v2/zxcvbn-entry.mjs` | IIFE-compatible local zxcvbn analyzer |
| `scripts/build-v2-runtime.mjs` | Reproducible V2 IIFE and language asset builds |
| `scripts/build-v2-pin-risk.mjs` | Versioned script-loadable PIN risk asset |
| `assets/v2/runtime.v2.min.js` | Built V2 runtime |
| `assets/v2/zxcvbn-analyzer.v2.min.js` | Built local zxcvbn analyzer |
| `assets/v2/pin-risk.v2.js` | Script-loadable PIN risk data for HTTP and file preview |
| `assets/v2/bip39/*.v2.js` | Script-loadable official BIP39 wordlists |
| `assets/v2/analytics-frame.html` | Sandboxed Google Analytics page-view frame |
| `tests/v2/*.test.mjs` | V2 unit, integration, privacy, build, and standard-vector tests |
| `tests/e2e/v2.spec.mjs` | Real-browser V2 critical journeys |
| `playwright.config.mjs` | Local static server and Chromium test configuration |

### Task 1: Bootstrap the isolated V2 entry and test toolchain

**Files:**
- Create: `index-2.0.html`
- Create: `tests/v2/bootstrap.test.mjs`
- Create: `playwright.config.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing V2 bootstrap test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const v1 = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const v2 = await readFile(new URL('../../index-2.0.html', import.meta.url), 'utf8');

test('V2 has an isolated entry and leaves the V1 marker intact', () => {
  assert.match(v1, /V1\.7\.5/);
  assert.match(v2, /V2\.0/);
  assert.match(v2, /password-generator:v2:settings/);
  assert.doesNotMatch(v1, /password-generator:v2:settings/);
});
```

- [ ] **Step 2: Run the bootstrap test and verify the missing-file failure**

Run: `node --test tests/v2/bootstrap.test.mjs`  
Expected: FAIL with `ENOENT` for `index-2.0.html`.

- [ ] **Step 3: Create the V2 copy and install pinned development dependencies**

Copy `index.html` byte-for-byte to `index-2.0.html`, then change only these initial markers before later tasks:

```js
const SETTINGS_KEY = 'password-generator:v2:settings';
const SETTINGS_SCHEMA_VERSION = 20;
```

Change visible/source version markers from `V1.7.5` to `V2.0`. Do not modify `index.html`.

Run:

```bash
npm install --save-dev @scure/bip39@2.3.0 @playwright/test@1.62.1 c8@12.0.0
```

Add scripts:

```json
{
  "build:v2": "node scripts/build-v2-runtime.mjs && node scripts/build-v2-pin-risk.mjs",
  "test:v2": "node --test tests/v2/*.test.mjs",
  "test:coverage:v2": "c8 --check-coverage --branches 80 --functions 80 --lines 80 --statements 80 node --test tests/v2/*.test.mjs",
  "test:e2e:v2": "playwright test tests/e2e/v2.spec.mjs"
}
```

Create `playwright.config.mjs`:

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:8765', browserName: 'chromium' },
  webServer: {
    command: 'python3 -m http.server 8765 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8765/index-2.0.html',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 4: Run V1 and V2 bootstrap tests**

Run: `node --test tests/v2/bootstrap.test.mjs && npm test`  
Expected: V2 bootstrap PASS and all existing V1 tests PASS.

- [ ] **Step 5: Commit the bootstrap**

```bash
git add index-2.0.html package.json package-lock.json playwright.config.mjs tests/v2/bootstrap.test.mjs
git commit -m "feat: bootstrap password generator v2"
```

### Task 2: Implement the unbiased random, combinatorics, and result foundations

**Files:**
- Create: `src/v2/random-core.mjs`
- Create: `src/v2/combinatorics.mjs`
- Create: `src/v2/result-model.mjs`
- Create: `tests/v2/random-core.test.mjs`
- Create: `tests/v2/combinatorics.test.mjs`
- Create: `tests/v2/result-model.test.mjs`

- [ ] **Step 1: Write failing tests for byte, integer, BigInt, and result invariants**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  secureRandomBytes,
  secureInt,
  secureBigIntBelow,
  weightedBigIntChoice,
} from '../../src/v2/random-core.mjs';

function queuedCrypto(chunks) {
  return {
    getRandomValues(target) {
      const chunk = chunks.shift();
      target.set(chunk.slice(0, target.length));
      return target;
    },
  };
}

test('secureInt rejects the biased tail', () => {
  const cryptoLike = queuedCrypto([Uint8Array.of(255), Uint8Array.of(4)]);
  assert.equal(secureInt(10, cryptoLike), 4);
});

test('secureBigIntBelow rejects values outside a non-power-of-two bound', () => {
  const cryptoLike = queuedCrypto([Uint8Array.of(255), Uint8Array.of(16)]);
  assert.equal(secureBigIntBelow(17n, cryptoLike), 16n);
});

test('weightedBigIntChoice maps the draw to cumulative exact weights', () => {
  const cryptoLike = queuedCrypto([Uint8Array.of(5)]);
  assert.equal(weightedBigIntChoice(['a', 'b'], [5n, 3n], cryptoLike), 'b');
});

test('secureRandomBytes returns an independent Uint8Array', () => {
  const value = secureRandomBytes(3, queuedCrypto([Uint8Array.of(1, 2, 3)]));
  assert.deepEqual([...value], [1, 2, 3]);
});
```

Add combinatorics assertions for `factorialBigInt`, `chooseBigInt`, `fallingFactorialBigInt`, and `log2BigInt`, plus result assertions that nested metadata is frozen and clearing zeroes mutable byte arrays.

- [ ] **Step 2: Run the foundation tests and verify module-not-found failures**

Run: `node --test tests/v2/random-core.test.mjs tests/v2/combinatorics.test.mjs tests/v2/result-model.test.mjs`  
Expected: FAIL because the V2 modules do not exist.

- [ ] **Step 3: Implement exact foundation APIs**

`random-core.mjs` must export:

```js
export function secureRandomBytes(length, cryptoLike = globalThis.crypto);
export function secureInt(maxExclusive, cryptoLike = globalThis.crypto);
export function secureBigIntBelow(maxExclusive, cryptoLike = globalThis.crypto);
export function weightedBigIntChoice(values, weights, cryptoLike = globalThis.crypto);
export function secureShuffle(values, cryptoLike = globalThis.crypto);
```

`secureBigIntBelow` computes the minimum byte width, masks unused high bits, and rejects candidates greater than or equal to the bound. `weightedBigIntChoice` sums BigInt weights, draws below the exact sum, and selects by cumulative weight.

`combinatorics.mjs` must export memoized exact arithmetic:

```js
export function factorialBigInt(n);
export function chooseBigInt(n, k);
export function fallingFactorialBigInt(n, k);
export function log2BigInt(value);
export function formatBigIntScientific(value, significantDigits = 3);
```

`result-model.mjs` must export:

```js
export function createGenerationResult({ id, type, schemeId, value, bytes, configSnapshot, generationModel, createdAt });
export function clearGenerationResult(result);
export function deepFreeze(value);
```

Reject invalid lengths, non-positive random bounds, negative weights, all-zero weights, duplicate result types, and non-finite entropy fields with explicit `TypeError` or `RangeError`.

- [ ] **Step 4: Run the foundation tests and coverage**

Run: `npx c8 --check-coverage --branches 80 --functions 80 --lines 80 --statements 80 node --test tests/v2/random-core.test.mjs tests/v2/combinatorics.test.mjs tests/v2/result-model.test.mjs`  
Expected: PASS with every threshold at or above 80%.

- [ ] **Step 5: Commit the foundations**

```bash
git add src/v2/random-core.mjs src/v2/combinatorics.mjs src/v2/result-model.mjs tests/v2/random-core.test.mjs tests/v2/combinatorics.test.mjs tests/v2/result-model.test.mjs
git commit -m "feat: add v2 exact random foundations"
```

### Task 3: Implement the exact constrained Password model

**Files:**
- Create: `src/v2/password-model.mjs`
- Create: `tests/v2/password-model.test.mjs`

- [ ] **Step 1: Write failing exhaustive small-space Password tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordModel } from '../../src/v2/password-model.mjs';

const tiny = {
  length: 3,
  pools: { lower: 'ab', upper: 'X', digit: '7', symbol: '!' },
  enabledClasses: ['lower', 'upper', 'digit', 'symbol'],
  requiredClasses: ['lower', 'symbol'],
  symbolRatioRange: [33, 34],
  startClasses: ['lower', 'upper', 'digit'],
  endClasses: ['lower', 'upper', 'digit', 'symbol'],
  allowRepeated: true,
};

function enumerate(config) {
  const alphabet = Object.values(config.pools).join('');
  const values = [];
  for (const a of alphabet) for (const b of alphabet) for (const c of alphabet) {
    const value = `${a}${b}${c}`;
    const symbols = [...value].filter((character) => config.pools.symbol.includes(character)).length;
    const valid = config.startClasses.some((name) => config.pools[name].includes(a))
      && symbols === 1
      && value.includes('!')
      && [...value].some((character) => config.pools.lower.includes(character));
    if (valid) values.push(value);
  }
  return new Set(values);
}

test('model count equals exhaustive legal outputs', () => {
  const model = createPasswordModel(tiny);
  assert.equal(model.searchSpace, BigInt(enumerate(tiny).size));
  assert.equal(model.minEntropyBits, Math.log2(enumerate(tiny).size));
});

test('custom one-symbol pool contributes one choice per symbol position', () => {
  const model = createPasswordModel({ ...tiny, length: 2, requiredClasses: ['symbol'], symbolRatioRange: [50, 50] });
  assert.equal(model.normalized.pools.symbol.length, 1);
});

test('no-repeat rejects lengths above the normalized unique pool', () => {
  assert.throws(() => createPasswordModel({ ...tiny, length: 6, allowRepeated: false }), /唯一字符/);
});
```

Add cases for excluded characters, overlapping custom symbols, required classes, first/last boundaries, spaces, broad symbol ranges, and no-repeat class quotas.

- [ ] **Step 2: Run the Password tests and verify the missing-model failure**

Run: `node --test tests/v2/password-model.test.mjs`  
Expected: FAIL because `password-model.mjs` does not exist.

- [ ] **Step 3: Implement normalized pools and exact completion counts**

Export:

```js
export function normalizePasswordConfig(config);
export function countPasswordOutputs(config);
export function createPasswordModel(config);
export function generatePassword(config, cryptoLike = globalThis.crypto);
```

Implementation sequence:

1. Deduplicate every pool and remove excluded characters.
2. Remove alphanumeric overlap from the custom symbol pool so each character has one class.
3. Convert symbol percentages to inclusive integer symbol counts using `ceil` and `floor`.
4. Enumerate each feasible total symbol count `k`.
5. For each `k`, count endpoint choices and interior completions with inclusion-exclusion over missing required classes.
6. For repeated characters, use pool-size powers and multinomial placement counts.
7. For no-repeat, use class-specific falling factorials and remaining class sizes.
8. Select `k`, endpoint classes, interior classes, and characters with `weightedBigIntChoice` using exact completion counts.
9. Store the exact BigInt `searchSpace` and `log2(searchSpace)` in the returned generation model.

The sampler must never select a branch with zero completions and must throw a validation error when the total search space is zero.

- [ ] **Step 4: Prove exhaustive agreement and retain existing randomness tests**

Run: `node --test tests/v2/password-model.test.mjs tests/randomness.test.mjs`  
Expected: PASS, including small-space equality and all V1 rejection-sampling checks.

- [ ] **Step 5: Commit the Password model**

```bash
git add src/v2/password-model.mjs tests/v2/password-model.test.mjs
git commit -m "feat: add exact constrained password model"
```

### Task 4: Implement the Passphrase model with result-stable entropy

**Files:**
- Create: `src/v2/passphrase-model.mjs`
- Create: `tests/v2/passphrase-model.test.mjs`

- [ ] **Step 1: Write failing Passphrase model tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPassphraseModel, generatePassphrase } from '../../src/v2/passphrase-model.mjs';

const words = ['alpha', 'bravo', 'cider', 'delta'];

test('word, random uppercase position, and random digit separators share one exact model', () => {
  const model = createPassphraseModel({ wordCount: 3, words, capitalization: 'random-uppercase', separator: 'random-digit' });
  assert.equal(model.searchSpace, 4n ** 3n * 3n * 10n ** 2n);
  assert.equal(model.minEntropyBits, Math.log2(Number(model.searchSpace)));
});

test('generated result retains the same model metadata as configured estimate', () => {
  const config = { wordCount: 2, words, capitalization: 'lowercase', separator: 'hyphen' };
  const before = createPassphraseModel(config);
  const result = generatePassphrase(config, { getRandomValues(target) { target.fill(0); return target; } });
  assert.equal(result.generationModel.searchSpace, before.searchSpace);
  assert.equal(result.generationModel.minEntropyBits, before.minEntropyBits);
});
```

Add tests for fixed separators, random symbols, every-word capitalization, first-word capitalization, one-word phrases, and duplicate word rejection.

- [ ] **Step 2: Run the Passphrase test and verify failure**

Run: `node --test tests/v2/passphrase-model.test.mjs`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement Passphrase counting and generation**

Export:

```js
export function createPassphraseModel(config);
export function generatePassphrase(config, cryptoLike = globalThis.crypto);
```

Use actual unique word count, independent word draws, exact separator choices per gap, and exact capitalization choice counts. Attach the same model object used before generation to the immutable result. Do not call zxcvbn or observed-character entropy from this module.

- [ ] **Step 4: Run Passphrase and existing word-pack tests**

Run: `node --test tests/v2/passphrase-model.test.mjs tests/memorable-engine.test.mjs tests/wordpacks.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit the Passphrase model**

```bash
git add src/v2/passphrase-model.mjs tests/v2/passphrase-model.test.mjs
git commit -m "feat: add exact passphrase generation model"
```

### Task 5: Replace PIN selection and entropy with exact completion-count DP

**Files:**
- Create: `src/v2/pin-model.mjs`
- Create: `tests/v2/pin-model.test.mjs`
- Create: `scripts/build-v2-pin-risk.mjs`
- Create: `assets/v2/pin-risk.v2.js`
- Test: `tests/pin-risk-engine.test.mjs`

- [ ] **Step 1: Write failing PIN count, sampler, and long-pattern tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinModel, detectWeakPinPatterns } from '../../src/v2/pin-model.mjs';

test('default six-digit model reports the exact audited constraint space', () => {
  const model = createPinModel({
    length: 6,
    allowLeadingZero: true,
    allowRepeated: true,
    limitSequential: true,
    blockWeak: false,
  });
  assert.equal(model.searchSpace, 940738n);
});

test('weak-pattern rules cover every supported length', () => {
  assert.ok(detectWeakPinPatterns('11111111').includes('全部重复'));
  assert.ok(detectWeakPinPatterns('12121212').includes('短周期循环'));
  assert.ok(detectWeakPinPatterns('25802580').includes('键盘路径'));
  assert.ok(detectWeakPinPatterns('000000000000').includes('全部重复'));
});

test('blockWeak subtracts exact candidates instead of a fixed bit penalty', () => {
  const open = createPinModel({ length: 4, allowLeadingZero: true, allowRepeated: true, limitSequential: false, blockWeak: false });
  const blocked = createPinModel({ length: 4, allowLeadingZero: true, allowRepeated: true, limitSequential: false, blockWeak: true });
  assert.equal(blocked.searchSpace, open.searchSpace - blocked.blockedCount);
  assert.notEqual(blocked.minEntropyBits, open.minEntropyBits - 0.03);
});
```

Add exhaustive 4-digit validation, 6-digit validation against a direct enumerator, no-repeat masks, leading zero, rank thresholds, dates, keypad paths, cycles, and 8/12-digit sampling tests.

- [ ] **Step 2: Run the PIN test and verify failure**

Run: `node --test tests/v2/pin-model.test.mjs`  
Expected: FAIL because `pin-model.mjs` does not exist.

- [ ] **Step 3: Implement the exact PIN model**

Export:

```js
export function detectWeakPinPatterns(pin);
export function createPinRiskIndex(payload);
export function countPinCompletions(config, riskIndex);
export function createPinModel(config, riskIndex);
export function generatePin(config, riskIndex, cryptoLike = globalThis.crypto);
```

Use memoized DP for leading zero, used-digit mask, sequence direction, and sequence length. Compile ranked 4/6 values into a searchable prefix index. Represent repeat, short-cycle, date, and keypad rules as exact terminal predicates plus countable pattern families; calculate their prefix-conditioned union with canonical generated pattern sets for 4/6 and finite-state counts for longer supported lengths. Subtract blocked suffix counts at every prefix, then sample each next digit directly by its allowed completion count. The public completion helpers, sampler, `blockedCount`, and `searchSpace` must therefore describe the same filtered output space without terminal rejection.

`scripts/build-v2-pin-risk.mjs` converts `assets/data/pin-risk.v1.json` into a classic script that assigns a frozen payload to `globalThis.PasswordGeneratorV2Assets.pinRisk`. It must preserve the source version, counts, thresholds, and hash.

- [ ] **Step 4: Run PIN tests and rebuild deterministically**

Run:

```bash
node scripts/build-v2-pin-risk.mjs
node --test tests/v2/pin-model.test.mjs tests/pin-risk-engine.test.mjs
git diff --exit-code -- assets/v2/pin-risk.v2.js
```

Expected: all tests PASS and the second build produces no diff.

- [ ] **Step 5: Commit the PIN model**

```bash
git add src/v2/pin-model.mjs scripts/build-v2-pin-risk.mjs assets/v2/pin-risk.v2.js tests/v2/pin-model.test.mjs
git commit -m "feat: add uniform constrained pin model"
```

### Task 6: Implement Token, API Secret, Hex, Random Bytes, and UUID

**Files:**
- Create: `src/v2/encoders.mjs`
- Create: `src/v2/byte-secret-models.mjs`
- Create: `src/v2/uuid-model.mjs`
- Create: `tests/v2/byte-secret-models.test.mjs`
- Create: `tests/v2/uuid-model.test.mjs`

- [ ] **Step 1: Write failing standard-format tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, generateApiSecret, generateHex, generateRandomBytes } from '../../src/v2/byte-secret-models.mjs';
import { generateUuidV4, generateUuidV7 } from '../../src/v2/uuid-model.mjs';

const fixedCrypto = { getRandomValues(target) { target.fill(0xab); return target; } };

test('byte-backed formats retain eight bits per random byte', () => {
  for (const generate of [generateToken, generateHex, generateRandomBytes]) {
    const result = generate({ byteLength: 32, encoding: 'hex' }, fixedCrypto);
    assert.equal(result.generationModel.minEntropyBits, 256);
    assert.equal(result.generationModel.randomByteLength, 32);
  }
});

test('fixed API Secret prefixes do not add entropy', () => {
  const result = generateApiSecret({ byteLength: 16, encoding: 'base64url-nopad', prefix: 'sk_test_' }, fixedCrypto);
  assert.ok(result.value.startsWith('sk_test_'));
  assert.equal(result.generationModel.minEntropyBits, 128);
});

test('UUID v4 fixes version and variant while keeping 122 random bits', () => {
  const result = generateUuidV4({ hyphens: true, uppercase: false }, fixedCrypto);
  assert.match(result.value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(result.generationModel.minEntropyBits, 122);
});

test('UUID v7 records 48 timestamp bits and 74 random bits', () => {
  const result = generateUuidV7({ hyphens: true }, fixedCrypto, () => 1_700_000_000_000);
  assert.equal(result.generationModel.minEntropyBits, 74);
  assert.equal(result.generationModel.timestampBits, 48);
});
```

Add RFC byte-vector assertions, Base64URL padding cases, Key ID + Secret separation, uppercase Hex, `0x` prefix, encoding switching over the same bytes, and binary Blob lifecycle helpers.

- [ ] **Step 2: Run format tests and verify failure**

Run: `node --test tests/v2/byte-secret-models.test.mjs tests/v2/uuid-model.test.mjs`  
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement byte-backed models and RFC 9562 UUIDs**

Export exact encoders:

```js
export function encodeHex(bytes, uppercase = false);
export function encodeBase64(bytes);
export function encodeBase64Url(bytes, padding = true);
export function decodeHex(value);
export function decodeBase64Url(value);
```

Export models:

```js
export function generateToken(config, cryptoLike);
export function generateApiSecret(config, cryptoLike);
export function generateHex(config, cryptoLike);
export function generateRandomBytes(config, cryptoLike);
export function formatExistingBytes(bytes, encoding, options);
export function generateUuidV4(config, cryptoLike);
export function generateUuidV7(config, cryptoLike, now);
```

All byte-backed models use `byteLength × 8`. Prefixes, casing, padding, hyphens, UUID version bits, UUID variant bits, and UUID v7 timestamps do not increase entropy.

- [ ] **Step 4: Run format tests and coverage**

Run: `npx c8 --check-coverage --branches 80 --functions 80 --lines 80 --statements 80 node --test tests/v2/byte-secret-models.test.mjs tests/v2/uuid-model.test.mjs`  
Expected: PASS with all thresholds satisfied.

- [ ] **Step 5: Commit byte-backed generators**

```bash
git add src/v2/encoders.mjs src/v2/byte-secret-models.mjs src/v2/uuid-model.mjs tests/v2/byte-secret-models.test.mjs tests/v2/uuid-model.test.mjs
git commit -m "feat: add byte secret and uuid generators"
```

### Task 7: Implement BIP39 Mnemonic with all official local wordlists

**Files:**
- Create: `src/v2/bip39-model.mjs`
- Create: `tests/v2/bip39-model.test.mjs`
- Create: `scripts/build-v2-runtime.mjs`
- Create: `assets/v2/bip39/*.v2.js`

- [ ] **Step 1: Write failing BIP39 vector and registry tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerBip39Wordlist, generateMnemonicFromEntropy, validateMnemonic } from '../../src/v2/bip39-model.mjs';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';

test('BIP39 official zero-entropy vector matches', () => {
  registerBip39Wordlist('english', english);
  const entropy = new Uint8Array(16);
  const result = generateMnemonicFromEntropy(entropy, 'english');
  assert.equal(result.value, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  assert.equal(result.generationModel.minEntropyBits, 128);
  assert.equal(result.generationModel.checksumBits, 4);
  assert.equal(result.words.length, 12);
  assert.equal(validateMnemonic(result.value, 'english'), true);
});

test('unsupported entropy lengths fail before generation', () => {
  assert.throws(() => generateMnemonicFromEntropy(new Uint8Array(17), 'english'), /128、160、192、224、256/);
});
```

Add official vectors for 160/192/224/256 bits, every language registration, ideographic spaces for Japanese, simplified/traditional Chinese distinction, and checksum mutation rejection.

- [ ] **Step 2: Run BIP39 tests and verify failure**

Run: `node --test tests/v2/bip39-model.test.mjs`  
Expected: FAIL because `bip39-model.mjs` does not exist.

- [ ] **Step 3: Implement the BIP39 registry and local builds**

Export:

```js
export const BIP39_ENTROPY_BITS = Object.freeze([128, 160, 192, 224, 256]);
export function registerBip39Wordlist(language, words);
export function getBip39WordlistStatus(language);
export function generateMnemonic(config, cryptoLike = globalThis.crypto);
export function generateMnemonicFromEntropy(entropy, language);
export function validateMnemonic(value, language);
```

Use `@scure/bip39` only through locally bundled code. Configure `scripts/build-v2-runtime.mjs` to produce one classic-script asset per official language: Czech, English, French, Italian, Japanese, Korean, Portuguese, Simplified Chinese, Spanish, and Traditional Chinese. Each asset registers exactly 2048 words with the V2 runtime and carries a stable language/version marker.

- [ ] **Step 4: Build and test every language asset**

Run:

```bash
npm run build:v2
node --test tests/v2/bip39-model.test.mjs
find assets/v2/bip39 -name '*.v2.js' | wc -l
```

Expected: BIP39 tests PASS and the asset count is 10.

- [ ] **Step 5: Commit BIP39 support**

```bash
git add src/v2/bip39-model.mjs scripts/build-v2-runtime.mjs assets/v2/bip39 tests/v2/bip39-model.test.mjs
git commit -m "feat: add local bip39 mnemonic generation"
```

### Task 8: Unify security assessment and explicit analyzer states

**Files:**
- Create: `src/v2/security-assessment.mjs`
- Create: `src/v2/zxcvbn-entry.mjs`
- Create: `tests/v2/security-assessment.test.mjs`
- Create: `tests/v2/zxcvbn-state.test.mjs`
- Modify: `scripts/build-v2-runtime.mjs`
- Create: `assets/v2/zxcvbn-analyzer.v2.min.js`

- [ ] **Step 1: Write failing assessment and state tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssessment, createResourceState } from '../../src/v2/security-assessment.mjs';

test('generator metrics survive result analysis unchanged', () => {
  const assessment = createAssessment({
    generationModel: { minEntropyBits: 256, averageGuessBits: 255, searchSpace: 2n ** 256n },
    patternAnalysis: { status: 'ready', guesses: 2 ** 40 },
  });
  assert.equal(assessment.generatorMinEntropyBits, 256);
  assert.equal(assessment.effectiveGuessBits, 40);
});

test('loading and failure never claim that no pattern was found', () => {
  for (const status of ['idle', 'loading', 'degraded', 'error']) {
    const assessment = createAssessment({
      generationModel: { minEntropyBits: 80, averageGuessBits: 79, searchSpace: 2n ** 80n },
      patternAnalysis: { status, guesses: null },
    });
    assert.notEqual(assessment.patternMessage, '未发现常见模式');
  }
});

test('all attack times use one effective guess count', () => {
  const assessment = createAssessment({
    generationModel: { minEntropyBits: 65, averageGuessBits: 64, searchSpace: 2n ** 65n },
    patternAnalysis: { status: 'ready', guesses: 2 ** 50 },
  });
  assert.equal(assessment.attackTimes.fastOffline.log2Seconds, 50 - Math.log2(1e10));
  assert.equal(assessment.attackTimes.slowHash.log2Seconds, 50 - Math.log2(1e4));
});
```

- [ ] **Step 2: Run the assessment tests and verify failure**

Run: `node --test tests/v2/security-assessment.test.mjs tests/v2/zxcvbn-state.test.mjs`  
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the assessment and analyzer contract**

Export:

```js
export const RESOURCE_STATUSES = Object.freeze(['idle', 'loading', 'ready', 'degraded', 'error']);
export const ATTACK_MODELS;
export const STRENGTH_LEVELS;
export function createResourceState(status, detail = '');
export function createAssessment({ generationModel, patternAnalysis });
export function assessObservedInput(value, patternAnalysis);
```

Keep static level copy free of crack-time strings. `ready` with a successful no-pattern result is the only state that returns “未发现常见模式”. Bundle `src/v2/zxcvbn-entry.mjs` as a local IIFE exposing sanitized `{ guesses, patternGuesses, patterns }` without plaintext tokens.

- [ ] **Step 4: Rebuild and run assessment plus existing zxcvbn tests**

Run: `npm run build:v2 && node --test tests/v2/security-assessment.test.mjs tests/v2/zxcvbn-state.test.mjs tests/zxcvbn-analyzer.test.mjs`  
Expected: PASS and a deterministic V2 analyzer asset.

- [ ] **Step 5: Commit unified assessment**

```bash
git add src/v2/security-assessment.mjs src/v2/zxcvbn-entry.mjs scripts/build-v2-runtime.mjs assets/v2/zxcvbn-analyzer.v2.min.js tests/v2/security-assessment.test.mjs tests/v2/zxcvbn-state.test.mjs
git commit -m "feat: unify v2 generator security assessment"
```

### Task 9: Build the browser runtime and wire all nine V2 modes

**Files:**
- Create: `src/v2/runtime-entry.mjs`
- Modify: `scripts/build-v2-runtime.mjs`
- Create: `assets/v2/runtime.v2.min.js`
- Modify: `index-2.0.html`
- Create: `tests/v2/runtime.integration.test.mjs`
- Create: `tests/v2/html.integration.test.mjs`

- [ ] **Step 1: Write failing runtime and HTML integration tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../index-2.0.html', import.meta.url), 'utf8');

test('V2 exposes all nine independent mode hashes', () => {
  for (const hash of ['#password', '#passphrase', '#pin', '#token', '#api-secret', '#uuid', '#hex', '#random-bytes', '#mnemonic']) {
    assert.ok(html.includes(hash), `missing ${hash}`);
  }
});

test('V2 loads only the local frozen runtime', () => {
  assert.match(html, /\.\/assets\/v2\/runtime\.v2\.min\.js/);
  assert.doesNotMatch(html, /unpkg|jsdelivr|cdnjs/);
});

test('V2 generator results read generationModel metadata', () => {
  assert.match(html, /generationModel\.minEntropyBits/);
  assert.doesNotMatch(html, /estimateGeneratedResult\(firstResult\)/);
});
```

- [ ] **Step 2: Run integration tests and verify missing-mode failures**

Run: `node --test tests/v2/runtime.integration.test.mjs tests/v2/html.integration.test.mjs`  
Expected: FAIL because the V2 runtime and modes are not wired.

- [ ] **Step 3: Build the frozen browser runtime**

`runtime-entry.mjs` exports one frozen object:

```js
globalThis.PasswordGeneratorV2 = Object.freeze({
  random,
  combinatorics,
  results,
  password,
  passphrase,
  pin,
  byteSecrets,
  uuid,
  bip39,
  assessment,
});
```

`scripts/build-v2-runtime.mjs` bundles it with esbuild as an IIFE, minifies it, writes `assets/v2/runtime.v2.min.js`, then rebuilds in memory and compares bytes for reproducibility.

- [ ] **Step 4: Replace V1-only mode routing and generation branches in `index-2.0.html`**

Use this exact mode map:

```js
const MODE_HASH_BY_MODE = Object.freeze({
  password: '#password',
  passphrase: '#passphrase',
  pin: '#pin',
  token: '#token',
  apiSecret: '#api-secret',
  uuid: '#uuid',
  hex: '#hex',
  randomBytes: '#random-bytes',
  mnemonic: '#mnemonic',
});
```

Add three grouped selectors and dedicated setting renderers. Every generation branch calls `PasswordGeneratorV2` and stores its immutable `GenerationResult`. Remove V2 calls to `estimateGeneratedResult()` and `estimateObservedCharacterEntropy()` for generated results. Preserve observed composition only in an explicitly labeled manual-analysis path.

- [ ] **Step 5: Run build, parse, and integration tests**

Run:

```bash
npm run build:v2
node --check <(sed -n '/const { useState/,/ReactDOM.createRoot/p' index-2.0.html)
node --test tests/v2/runtime.integration.test.mjs tests/v2/html.integration.test.mjs
```

If process substitution is unavailable, extract the app block to a temporary file with a read-only test helper and run `node --check` on that file.  
Expected: runtime and HTML integration tests PASS; all nine hashes are present.

- [ ] **Step 6: Commit the V2 runtime and modes**

```bash
git add src/v2/runtime-entry.mjs scripts/build-v2-runtime.mjs assets/v2/runtime.v2.min.js index-2.0.html tests/v2/runtime.integration.test.mjs tests/v2/html.integration.test.mjs
git commit -m "feat: add nine v2 generator modes"
```

### Task 10: Enforce explicit Copy, memory-only History, and masked DOM

**Files:**
- Modify: `index-2.0.html`
- Create: `tests/v2/privacy.integration.test.mjs`
- Create: `tests/e2e/v2.spec.mjs`

- [ ] **Step 1: Write failing privacy integration assertions**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../index-2.0.html', import.meta.url), 'utf8');

test('Generate and Copy are separate actions', () => {
  assert.match(html, /function generateResults\(/);
  assert.match(html, /function copyCurrentResults\(/);
  assert.doesNotMatch(html, /function generateAndCopy\(/);
});

test('V2 has no persistent secret-history key', () => {
  assert.doesNotMatch(html, /HISTORY_SESSION_KEY/);
  assert.doesNotMatch(html, /sessionStorage\.setItem/);
});

test('clipboard fallback clears and removes its textarea in finally', () => {
  assert.match(html, /finally\s*\{[\s\S]*?textarea\.value\s*=\s*(?:''|"")[\s\S]*?textarea\.remove\(\)/);
});
```

- [ ] **Step 2: Write failing real-browser privacy journeys**

```js
import { test, expect } from '@playwright/test';

test('Generate does not copy and masked output excludes plaintext DOM', async ({ page }) => {
  let clipboardWrites = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => { globalThis.__clipboardWrites += 1; } },
    });
    globalThis.__clipboardWrites = 0;
  });
  await page.goto('/index-2.0.html#password');
  await page.getByRole('button', { name: /^生成/ }).click();
  clipboardWrites = await page.evaluate(() => globalThis.__clipboardWrites);
  expect(clipboardWrites).toBe(0);
  await expect(page.locator('[data-secret-state="masked"]')).toBeVisible();
  expect(await page.locator('body').textContent()).not.toContain('V2_E2E_SECRET_SENTINEL');
});
```

Add journeys for explicit Copy, per-result Reveal/Hide, batch masking, Tooltip/title/aria scanning, History default-off, in-memory History cap 100, clear, and fallback cleanup after a thrown `execCommand`.

- [ ] **Step 3: Implement privacy-safe result state and UI**

Replace `generateAndCopy` with `generateResults`. Keep values only in React state and optional memory History. Add:

```js
const [historyEnabled, setHistoryEnabled] = useState(false);
const [revealedResultIds, setRevealedResultIds] = useState(() => new Set());

function maskedValue(value) {
  const length = [...String(value)].length;
  return '•'.repeat(Math.min(length, 96)) + (length > 96 ? `（${length} 字符）` : '');
}

function appendHistory(entries) {
  if (!historyEnabled) return;
  setHistory((current) => [...entries, ...current].slice(0, 100));
}
```

Do not store plaintext in Tooltip, `title`, `aria-label`, success messages, or hidden DOM nodes. Copy directly from React state without revealing. Remove all V2 History session persistence. `localStorage` may store `historyEnabled`, but not `history`.

Wrap fallback cleanup exactly:

```js
const textarea = document.createElement('textarea');
try {
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  return document.execCommand('copy');
} finally {
  textarea.value = '';
  textarea.remove();
}
```

- [ ] **Step 4: Run privacy integration and Chromium E2E**

Run:

```bash
node --test tests/v2/privacy.integration.test.mjs
npx playwright install chromium
npm run test:e2e:v2
```

Expected: PASS; Generate produces zero clipboard writes and masked secrets are absent from DOM text and attributes.

- [ ] **Step 5: Commit privacy behavior**

```bash
git add index-2.0.html tests/v2/privacy.integration.test.mjs tests/e2e/v2.spec.mjs
git commit -m "feat: harden v2 secret handling"
```

### Task 11: Isolate Google Analytics in a sandbox iframe

**Files:**
- Create: `assets/v2/analytics-frame.html`
- Modify: `index-2.0.html`
- Create: `tests/v2/analytics-isolation.test.mjs`
- Modify: `tests/e2e/v2.spec.mjs`

- [ ] **Step 1: Write failing structural isolation tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const parent = await readFile(new URL('../../index-2.0.html', import.meta.url), 'utf8');
const frame = await readFile(new URL('../../assets/v2/analytics-frame.html', import.meta.url), 'utf8');

test('Google executable code exists only in the sandboxed frame', () => {
  assert.doesNotMatch(parent, /googletagmanager\.com\/gtag\/js/);
  assert.doesNotMatch(parent, /google-analytics\.com/);
  assert.match(parent, /sandbox="allow-scripts"/);
  assert.doesNotMatch(parent, /allow-same-origin/);
  assert.match(parent, /referrerpolicy="no-referrer"/);
  assert.match(frame, /G-DWZ72TFWQF/);
  assert.match(frame, /googletagmanager\.com\/gtag\/js/);
});

test('analytics frame uses a fixed public page location and no message bridge', () => {
  assert.match(frame, /https:\/\/betaer\.github\.io\/password-generator\/index-2\.0\.html/);
  assert.doesNotMatch(frame, /addEventListener\(['"]message/);
  assert.doesNotMatch(parent, /postMessage\(/);
});
```

- [ ] **Step 2: Run isolation tests and verify missing-frame failure**

Run: `node --test tests/v2/analytics-isolation.test.mjs`  
Expected: FAIL because the frame does not exist and Google code remains in the copied V2 page.

- [ ] **Step 3: Create the analytics frame and tighten parent CSP**

Create `assets/v2/analytics-frame.html` with its own restrictive CSP, the existing Measurement ID, disabled Google signals/personalization, and fixed V2 `page_location`. The parent contains only:

```html
<iframe
  src="./assets/v2/analytics-frame.html"
  title=""
  aria-hidden="true"
  tabindex="-1"
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
  hidden></iframe>
```

The parent CSP removes every Google domain from `script-src`, `connect-src`, and `img-src`, and adds `frame-src 'self'`. The frame does not read `window.parent`, query parameters, hash, referrer, storage, or messages.

- [ ] **Step 4: Add a browser network sentinel test**

Intercept GA requests in Playwright, generate and reveal a fixed sentinel secret through an injected deterministic runtime, and assert no request URL or POST body contains the sentinel. In the frame, evaluate `window.parent.document` and assert a cross-origin `SecurityError` or inaccessible document.

Run: `node --test tests/v2/analytics-isolation.test.mjs && npm run test:e2e:v2`  
Expected: structural and browser isolation tests PASS; at least one GA request is observed when network access is available, and no request includes the sentinel.

- [ ] **Step 5: Commit analytics isolation**

```bash
git add assets/v2/analytics-frame.html index-2.0.html tests/v2/analytics-isolation.test.mjs tests/e2e/v2.spec.mjs
git commit -m "feat: isolate v2 analytics from secrets"
```

### Task 12: Complete async resource behavior, file compatibility, and UI security copy

**Files:**
- Modify: `index-2.0.html`
- Modify: `src/v2/runtime-entry.mjs`
- Modify: `scripts/build-v2-runtime.mjs`
- Create: `tests/v2/resource-state.integration.test.mjs`
- Modify: `tests/e2e/v2.spec.mjs`

- [ ] **Step 1: Write failing slow/failure resource tests**

Create tests that intercept V2 zxcvbn, PIN risk, Passphrase pack, and BIP39 language assets and delay or fail them. Assert these exact visible states:

```js
const expectedStates = Object.freeze({
  idle: '尚未加载安全分析',
  loading: '安全分析正在加载',
  ready: '安全分析已完成',
  degraded: '部分安全分析不可用，当前显示生成器精确熵',
  error: '安全资源加载失败，请重试',
});
```

Assert `blockWeak=true` PIN and selected BIP39 language generation are disabled until ready. Assert zxcvbn failure keeps Password generation enabled but never displays “未发现常见模式”.

- [ ] **Step 2: Run resource-state tests and verify failures**

Run: `node --test tests/v2/resource-state.integration.test.mjs && npm run test:e2e:v2`  
Expected: FAIL because the copied V2 page still silently swallows analyzer failures.

- [ ] **Step 3: Implement the shared script loader and state machine**

Use classic script injection so HTTP and `file://` can load local IIFE assets:

```js
function loadLocalScriptOnce(src, globalCheck) {
  if (globalCheck()) return Promise.resolve();
  if (resourcePromises.has(src)) return resourcePromises.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => globalCheck() ? resolve() : reject(new Error(`资源未注册：${src}`));
    script.onerror = () => reject(new Error(`资源加载失败：${src}`));
    document.head.appendChild(script);
  });
  resourcePromises.set(src, promise);
  return promise;
}
```

Wire explicit `idle/loading/ready/degraded/error` state, retry buttons, and generation preconditions. Replace stale fixed crack-time advice with dynamic `assessment.attackTimes` copy only.

- [ ] **Step 4: Run HTTP, file-preview, and failure-state tests**

Run: `node --test tests/v2/resource-state.integration.test.mjs && npm run test:e2e:v2`  
Expected: PASS for success, delayed, failed, retried, and degraded paths.

- [ ] **Step 5: Commit resource-state behavior**

```bash
git add index-2.0.html src/v2/runtime-entry.mjs scripts/build-v2-runtime.mjs tests/v2/resource-state.integration.test.mjs tests/e2e/v2.spec.mjs
git commit -m "feat: make v2 security resource states explicit"
```

### Task 13: Update V2 documentation, notices, versioning, and reproducible build checks

**Files:**
- Modify: `README.md`
- Modify: `docs/readme-en.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `package.json`
- Create: `tests/v2/docs.test.mjs`
- Create: `tests/v2/build-reproducibility.test.mjs`

- [ ] **Step 1: Write failing documentation and notice tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
const notices = await readFile(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');

test('README distinguishes stable V1 and complete V2 entry points', () => {
  assert.match(readme, /index\.html.*V1\.7\.5/s);
  assert.match(readme, /index-2\.0\.html.*V2\.0/s);
});

test('README states the real V2 secret boundaries', () => {
  assert.match(readme, /History 默认关闭/);
  assert.match(readme, /显式点击.*复制/);
  assert.match(readme, /sandbox iframe/);
  assert.match(readme, /JavaScript.*无法可靠.*清零/);
});

test('third-party notices cover BIP39 and analytics isolation', () => {
  assert.match(notices, /@scure\/bip39/);
  assert.match(notices, /BIP39 wordlists/);
  assert.match(notices, /Google Analytics/);
});
```

- [ ] **Step 2: Run docs tests and verify failure**

Run: `node --test tests/v2/docs.test.mjs tests/v2/build-reproducibility.test.mjs`  
Expected: FAIL because V2 docs and reproducibility checks are incomplete.

- [ ] **Step 3: Update documentation and build metadata**

Set package version to `2.0.0`. Document all nine generators, exact probability terminology, stable and V2 URLs, masking, explicit Copy, memory-only opt-in History, GA sandbox, no reliable String zeroization, BIP39 languages, API/wallet test-format warnings, and same-origin assets. Add exact dependency versions, upstream URLs, licenses, and hashes to `THIRD_PARTY_NOTICES.md`.

`build-reproducibility.test.mjs` runs the V2 builders in a temporary directory, hashes every generated V2 asset, and compares hashes with committed files without changing the working tree.

- [ ] **Step 4: Run all documentation and build tests**

Run: `node --test tests/v2/docs.test.mjs tests/v2/build-reproducibility.test.mjs tests/security-docs.test.mjs`  
Expected: PASS for both V1-specific and V2-specific copy.

- [ ] **Step 5: Commit docs and version**

```bash
git add README.md docs/readme-en.md THIRD_PARTY_NOTICES.md package.json package-lock.json tests/v2/docs.test.mjs tests/v2/build-reproducibility.test.mjs
git commit -m "docs: document password generator v2"
```

### Task 14: Full verification, security review, independent code review, and GitHub release push

**Files:**
- Modify only files required by verified review findings
- Test: all V1, V2, and E2E suites

- [ ] **Step 1: Run the full deterministic build and test suite**

```bash
npm run build:v2
npm test
npm run test:v2
npm run test:coverage:v2
npm run test:e2e:v2
git diff --check
git status --short
```

Expected: every command PASS; coverage thresholds are at least 80%; `git diff --check` prints nothing; only intentional uncommitted review fixes may appear.

- [ ] **Step 2: Run targeted security scans**

```bash
rg -n "Math\.random\(|sessionStorage\.(setItem|getItem)|generated_value|generateAndCopy|googletagmanager\.com" index-2.0.html src/v2 assets/v2 tests/v2
rg -n "value: item\.value|title: item\.value|aria-label.*value|console\.(log|error).*value" index-2.0.html src/v2
npm audit --omit=dev
```

Expected:

- no business `Math.random()`;
- no secret History storage;
- no `generateAndCopy`;
- Google Tag Manager appears only in `assets/v2/analytics-frame.html` and its tests/notices;
- no plaintext result is placed in Tooltip/title/aria/log code paths;
- production dependency audit has no unresolved high or critical vulnerability.

- [ ] **Step 3: Request independent code review over the complete V2 range**

Use base SHA `9ca5017` and the current HEAD. Provide the approved design specification and this plan. Require the reviewer to check exact constrained distributions, GeneratorResult metadata, PIN 8/12 behavior, BIP39 vectors, clipboard cleanup, History storage, masked DOM, GA sandbox, async failure states, and V1 isolation.

Expected: no Critical or Important findings remain. Fix every valid Critical or Important issue with a failing regression test before implementation changes, rerun the relevant suites, and commit the fix.

- [ ] **Step 4: Perform final local and online-ready verification**

```bash
git status --short --branch
git log --oneline 9ca5017..HEAD
git diff --stat 9ca5017..HEAD
npm run build:v2
npm test && npm run test:v2 && npm run test:coverage:v2 && npm run test:e2e:v2
```

Expected: clean working tree, coherent V2 commit series, deterministic build, all tests and coverage PASS.

- [ ] **Step 5: Push to GitHub**

```bash
git push origin main
```

Expected: push succeeds and `main` is synchronized with `origin/main`.

- [ ] **Step 6: Verify GitHub Pages after deployment**

Open `https://betaer.github.io/password-generator/index-2.0.html` with a cache-busting query, confirm the deployed asset hashes match local files, run one generation journey for each of the nine modes, verify explicit Copy, masked DOM, GA frame request, and zero secret-bearing network parameters.

Expected: online V2.0 matches the pushed commit and all smoke checks PASS.
