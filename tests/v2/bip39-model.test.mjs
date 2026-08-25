import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import {
  BIP39_ENTROPY_BITS,
  generateMnemonic,
  generateMnemonicFromEntropy,
  getBip39WordlistStatus,
  registerBip39Wordlist,
  validateMnemonic,
} from '../../src/v2/bip39-model.mjs';
import {
  buildBip39Assets,
  buildRuntimeAssets,
  buildV2Runtime,
} from '../../scripts/build-v2-runtime.mjs';
import { wordlist as czech } from '@scure/bip39/wordlists/czech.js';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import { wordlist as french } from '@scure/bip39/wordlists/french.js';
import { wordlist as italian } from '@scure/bip39/wordlists/italian.js';
import { wordlist as japanese } from '@scure/bip39/wordlists/japanese.js';
import { wordlist as korean } from '@scure/bip39/wordlists/korean.js';
import { wordlist as portuguese } from '@scure/bip39/wordlists/portuguese.js';
import { wordlist as simplifiedChinese } from '@scure/bip39/wordlists/simplified-chinese.js';
import { wordlist as spanish } from '@scure/bip39/wordlists/spanish.js';
import { wordlist as traditionalChinese } from '@scure/bip39/wordlists/traditional-chinese.js';

const OFFICIAL_WORDLISTS = Object.freeze({
  czech,
  english,
  french,
  italian,
  japanese,
  korean,
  portuguese,
  'simplified-chinese': simplifiedChinese,
  spanish,
  'traditional-chinese': traditionalChinese,
});

const ZERO_ENTROPY_VECTORS = Object.freeze([
  [128, 12, 'about'],
  [160, 15, 'address'],
  [192, 18, 'agent'],
  [224, 21, 'admit'],
  [256, 24, 'art'],
]);

for (const [language, words] of Object.entries(OFFICIAL_WORDLISTS)) {
  registerBip39Wordlist(language, words);
}

test('BIP39 supports exactly the standard ENT values', () => {
  assert.deepEqual(BIP39_ENTROPY_BITS, [128, 160, 192, 224, 256]);
  assert.equal(Object.isFrozen(BIP39_ENTROPY_BITS), true);
});

test('all ten official wordlists register as immutable 2048-word resources', () => {
  for (const language of Object.keys(OFFICIAL_WORDLISTS)) {
    assert.deepEqual(getBip39WordlistStatus(language), {
      language,
      state: 'ready',
      wordCount: 2048,
    });
    assert.equal(Object.isFrozen(getBip39WordlistStatus(language)), true);
  }

  assert.deepEqual(getBip39WordlistStatus('not-loaded'), {
    language: 'not-loaded',
    state: 'idle',
    wordCount: 0,
  });
});

test('all ten official languages generate checksum-valid mnemonics', () => {
  const entropy = Uint8Array.from({ length: 20 }, (_, index) => index);
  for (const language of Object.keys(OFFICIAL_WORDLISTS)) {
    const result = generateMnemonicFromEntropy(entropy, language);
    assert.equal(result.words.length, 15);
    assert.equal(result.generationModel.minEntropyBits, 160);
    assert.equal(result.generationModel.checksumBits, 5);
    assert.equal(validateMnemonic(result.value, language), true);
  }
});

test('wordlist registration rejects malformed and conflicting resources', () => {
  assert.throws(() => registerBip39Wordlist(null, english), /language/i);
  assert.throws(() => registerBip39Wordlist('', english), /language/i);
  assert.throws(() => registerBip39Wordlist('bad language', english), /language/i);
  assert.throws(() => registerBip39Wordlist('short-list', ['only']), /2048/);
  assert.throws(
    () => registerBip39Wordlist('non-string-list', [...english.slice(0, -1), null]),
    /non-empty string/i,
  );
  assert.throws(
    () => registerBip39Wordlist('non-normalized-list', [...english.slice(0, -1), '\u00e9']),
    /NFKD/i,
  );
  assert.throws(
    () => registerBip39Wordlist('duplicate-list', Array.from({ length: 2048 }, () => 'same')),
    /unique/i,
  );
  assert.throws(
    () => registerBip39Wordlist('english', [...english.slice(0, -1), 'replacement']),
    /already registered/i,
  );

  assert.doesNotThrow(() => registerBip39Wordlist('english', [...english]));
});

test('official zero-entropy vectors match for every supported ENT size', () => {
  for (const [entropyBits, wordCount, finalWord] of ZERO_ENTROPY_VECTORS) {
    const entropy = new Uint8Array(entropyBits / 8);
    const result = generateMnemonicFromEntropy(entropy, 'english');
    const expected = [...Array(wordCount - 1).fill('abandon'), finalWord].join(' ');

    assert.equal(result.value, expected);
    assert.equal(result.type, 'mnemonic');
    assert.equal(result.schemeId, 'bip39-mnemonic');
    assert.equal(result.words.length, wordCount);
    assert.equal(Object.isFrozen(result.words), true);
    assert.equal(result.generationModel.sourceEntropyBits, entropyBits);
    assert.equal(result.generationModel.minEntropyBits, entropyBits);
    assert.equal(result.generationModel.shannonEntropyBits, entropyBits);
    assert.equal(result.generationModel.checksumBits, entropyBits / 32);
    assert.equal(result.generationModel.searchSpace, 1n << BigInt(entropyBits));
    assert.equal(result.configSnapshot.language, 'english');
    assert.equal(result.configSnapshot.entropyBits, entropyBits);
    assert.equal(validateMnemonic(result.value, 'english'), true);

    entropy.fill(0xff);
    assert.deepEqual(result.bytes, new Uint8Array(entropyBits / 8));
  }
});

test('unsupported entropy lengths and unavailable languages fail before generation', () => {
  assert.throws(
    () => generateMnemonicFromEntropy(new Uint8Array(17), 'english'),
    /128、160、192、224、256/,
  );
  assert.throws(
    () => generateMnemonicFromEntropy(new Uint8Array(16), 'unavailable-language'),
    /not ready/i,
  );
  assert.throws(() => generateMnemonicFromEntropy([], 'english'), /Uint8Array/);
});

test('generateMnemonic draws exactly ENT bytes from the injected Web Crypto source', () => {
  const calls = [];
  const cryptoLike = {
    getRandomValues(target) {
      calls.push(target.length);
      target.fill(0);
      return target;
    },
  };

  const result = generateMnemonic({ entropyBits: 224, language: 'english' }, cryptoLike);
  assert.deepEqual(calls, [28]);
  assert.equal(result.words.length, 21);
  assert.equal(result.generationModel.minEntropyBits, 224);
  assert.throws(
    () => generateMnemonic({ entropyBits: 129, language: 'english' }, cryptoLike),
    /128、160、192、224、256/,
  );
  assert.throws(
    () => generateMnemonic({ entropyBits: 128, language: 'english' }, {}),
    /Web Crypto/,
  );
  assert.throws(() => generateMnemonic(null, cryptoLike), /config must be an object/i);
});

test('Japanese uses ideographic spaces and remains checksum-valid', () => {
  const result = generateMnemonicFromEntropy(new Uint8Array(16), 'japanese');
  assert.equal(result.value.includes('\u3000'), true);
  assert.equal(result.value.includes(' '), false);
  assert.equal(result.words.length, 12);
  assert.equal(result.value.split('\u3000').length, 12);
  assert.equal(validateMnemonic(result.value, 'japanese'), true);
});

test('simplified and traditional Chinese remain distinct registries', () => {
  const entropy = Uint8Array.from({ length: 16 }, (_, index) => index);
  const simplified = generateMnemonicFromEntropy(entropy, 'simplified-chinese');
  const traditional = generateMnemonicFromEntropy(entropy, 'traditional-chinese');

  assert.notEqual(simplified.value, traditional.value);
  assert.equal(simplified.value.includes('欧'), true);
  assert.equal(traditional.value.includes('歐'), true);
  assert.equal(validateMnemonic(simplified.value, 'simplified-chinese'), true);
  assert.equal(validateMnemonic(traditional.value, 'traditional-chinese'), true);
});

test('checksum and unknown-word mutations are rejected', () => {
  const result = generateMnemonicFromEntropy(new Uint8Array(16), 'english');
  const checksumMutation = [...result.words.slice(0, -1), 'abandon'].join(' ');
  const unknownWordMutation = [...result.words.slice(0, -1), 'not-a-bip39-word'].join(' ');

  assert.equal(validateMnemonic(checksumMutation, 'english'), false);
  assert.equal(validateMnemonic(unknownWordMutation, 'english'), false);
  assert.equal(validateMnemonic(null, 'english'), false);
  assert.throws(() => validateMnemonic(result.value, 'not-loaded'), /not ready/i);
});

test('classic wordlist assets are complete and reproducible', async () => {
  const firstDirectory = await mkdtemp(path.join(tmpdir(), 'password-generator-v2-bip39-a-'));
  const secondDirectory = await mkdtemp(path.join(tmpdir(), 'password-generator-v2-bip39-b-'));
  try {
    await buildBip39Assets({ outputDirectory: firstDirectory });
    await buildBip39Assets({ outputDirectory: secondDirectory });

    const firstNames = (await readdir(firstDirectory)).sort();
    const secondNames = (await readdir(secondDirectory)).sort();
    const expectedNames = Object.keys(OFFICIAL_WORDLISTS)
      .map((language) => `${language}.v2.js`)
      .sort();
    assert.deepEqual(firstNames, expectedNames);
    assert.deepEqual(secondNames, expectedNames);

    for (const name of firstNames) {
      const [firstSource, secondSource] = await Promise.all([
        readFile(path.join(firstDirectory, name), 'utf8'),
        readFile(path.join(secondDirectory, name), 'utf8'),
      ]);
      assert.equal(firstSource, secondSource);
      assert.doesNotMatch(firstSource, /^\s*(?:import|export)\s/m);

      const registrations = [];
      const context = {
        PasswordGeneratorV2: {
          registerBip39Wordlist(language, words) {
            registrations.push({ language, words });
          },
        },
      };
      context.globalThis = context;
      vm.runInNewContext(firstSource, context, { filename: name });

      assert.equal(registrations.length, 1);
      assert.equal(registrations[0].words.length, 2048);
      assert.equal(Object.isFrozen(registrations[0].words), true);
      const language = name.replace(/\.v2\.js$/, '');
      assert.equal(registrations[0].language, language);
      assert.equal(context.PasswordGeneratorV2Bip39Assets[language].version, 'bip39@2.3.0');
      assert.equal(context.PasswordGeneratorV2Bip39Assets[language].wordCount, 2048);
    }
  } finally {
    await Promise.all([
      rm(firstDirectory, { recursive: true, force: true }),
      rm(secondDirectory, { recursive: true, force: true }),
    ]);
  }
});

test('classic assets queue safely when loaded before the V2 runtime', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'password-generator-v2-bip39-queue-'));
  try {
    await buildBip39Assets({ outputDirectory });
    const source = await readFile(path.join(outputDirectory, 'english.v2.js'), 'utf8');
    const context = {};
    context.globalThis = context;
    vm.runInNewContext(source, context, { filename: 'english.v2.js' });

    assert.equal(context.PasswordGeneratorV2PendingWordlists.length, 1);
    assert.equal(context.PasswordGeneratorV2PendingWordlists[0].language, 'english');
    assert.equal(context.PasswordGeneratorV2PendingWordlists[0].words.length, 2048);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('runtime builder skips a missing entry and reproducibly bundles a present one', async () => {
  const missingProject = await mkdtemp(path.join(tmpdir(), 'password-generator-v2-runtime-missing-'));
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'password-generator-v2-runtime-present-'));
  try {
    assert.deepEqual(await buildRuntimeAssets({ projectRoot: missingProject }), []);

    const sourceDirectory = path.join(projectRoot, 'src/v2');
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      path.join(sourceDirectory, 'runtime-entry.mjs'),
      "export const runtimeVersion = '2.0.0-test';\n",
      'utf8',
    );

    const firstOutputs = await buildRuntimeAssets({ projectRoot });
    const firstBundle = await readFile(firstOutputs[0], 'utf8');
    const secondOutputs = await buildRuntimeAssets({ projectRoot });
    const secondBundle = await readFile(secondOutputs[0], 'utf8');
    assert.equal(firstBundle, secondBundle);

    const context = {};
    context.globalThis = context;
    vm.runInNewContext(firstBundle, context, { filename: 'runtime.v2.min.js' });
    assert.equal(context.PasswordGeneratorV2.runtimeVersion, '2.0.0-test');

    const allOutputs = await buildV2Runtime({ projectRoot });
    assert.equal(allOutputs.length, 11);
    assert.equal((await readdir(path.join(projectRoot, 'assets/v2/bip39'))).length, 10);
  } finally {
    await Promise.all([
      rm(missingProject, { recursive: true, force: true }),
      rm(projectRoot, { recursive: true, force: true }),
    ]);
  }
});
