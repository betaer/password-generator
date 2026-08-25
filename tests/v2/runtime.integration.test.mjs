import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import runtime, {
  drainPendingBip39Wordlists,
  RUNTIME_VERSION,
} from '../../src/v2/runtime-entry.mjs';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import {
  buildRuntimeAssets,
  buildV2Runtime,
} from '../../scripts/build-v2-runtime.mjs';

const EXPECTED_NAMESPACES = Object.freeze([
  'assessment',
  'bip39',
  'byteSecrets',
  'combinatorics',
  'passphrase',
  'password',
  'pin',
  'random',
  'results',
  'uuid',
]);

test('source runtime exposes only the ten frozen V2 namespaces', () => {
  assert.equal(RUNTIME_VERSION, '2.0.0');
  assert.equal(globalThis.PasswordGeneratorV2, runtime);
  assert.equal(Object.isFrozen(runtime), true);
  assert.deepEqual(Object.keys(runtime).sort(), EXPECTED_NAMESPACES);

  for (const namespace of Object.values(runtime)) {
    assert.equal(Object.isFrozen(namespace), true);
  }

  assert.equal(typeof runtime.random.secureRandomBytes, 'function');
  assert.equal(typeof runtime.password.generatePassword, 'function');
  assert.equal(typeof runtime.passphrase.generatePassphrase, 'function');
  assert.equal(typeof runtime.pin.generatePin, 'function');
  assert.equal(typeof runtime.byteSecrets.generateToken, 'function');
  assert.equal(typeof runtime.uuid.generateUuidV7, 'function');
  assert.equal(typeof runtime.bip39.generateMnemonic, 'function');
  assert.equal(typeof runtime.assessment.createAssessment, 'function');
});

test('source queue drain registers pending wordlists and is idempotent when empty', () => {
  globalThis.PasswordGeneratorV2PendingWordlists = [{
    language: 'english',
    version: 'bip39@2.3.0',
    words: [...english],
  }];

  drainPendingBip39Wordlists();
  assert.equal(runtime.bip39.getBip39WordlistStatus('english').state, 'ready');
  assert.equal(globalThis.PasswordGeneratorV2PendingWordlists.length, 0);
  assert.doesNotThrow(() => drainPendingBip39Wordlists());
});

test('runtime bundle is deterministic, local, and classic-script compatible', async () => {
  const [firstOutput] = await buildRuntimeAssets();
  const firstSource = await readFile(firstOutput, 'utf8');
  const [secondOutput] = await buildRuntimeAssets();
  const secondSource = await readFile(secondOutput, 'utf8');

  assert.equal(firstSource, secondSource);
  assert.doesNotMatch(firstSource, /^\s*(?:import|export)\s/m);
  assert.doesNotMatch(firstSource, /https?:\/\//u);

  const context = {
    PASSWORD_GENERATOR_VERSION: '1.7.5',
  };
  context.globalThis = context;
  vm.runInNewContext(firstSource, context, { filename: 'runtime.v2.min.js' });

  assert.equal(context.PASSWORD_GENERATOR_VERSION, '1.7.5');
  assert.equal(Object.isFrozen(context.PasswordGeneratorV2), true);
  assert.deepEqual(
    Object.keys(context.PasswordGeneratorV2).sort(),
    EXPECTED_NAMESPACES,
  );
});

test('browser runtime drains wordlists loaded before the runtime asset', async () => {
  const [outputFile] = await buildRuntimeAssets();
  const source = await readFile(outputFile, 'utf8');
  const pendingEntry = Object.freeze({
    language: 'english',
    version: 'bip39@2.3.0',
    words: Object.freeze([...english]),
  });
  const context = {
    PasswordGeneratorV2PendingWordlists: [pendingEntry],
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'runtime.v2.min.js' });

  const status = context.PasswordGeneratorV2.bip39.getBip39WordlistStatus('english');
  assert.equal(status.state, 'ready');
  assert.equal(status.wordCount, 2048);
  assert.equal(context.PasswordGeneratorV2PendingWordlists.length, 0);
});

test('wordlists loaded on demand after runtime register immediately', async () => {
  await buildV2Runtime();
  const [runtimeSource, wordlistSource] = await Promise.all([
    readFile(new URL('../../assets/v2/runtime.v2.min.js', import.meta.url), 'utf8'),
    readFile(new URL('../../assets/v2/bip39/english.v2.js', import.meta.url), 'utf8'),
  ]);
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(runtimeSource, context, { filename: 'runtime.v2.min.js' });
  assert.equal(
    context.PasswordGeneratorV2.bip39.getBip39WordlistStatus('english').state,
    'idle',
  );

  vm.runInNewContext(wordlistSource, context, { filename: 'english.v2.js' });
  assert.equal(
    context.PasswordGeneratorV2.bip39.getBip39WordlistStatus('english').state,
    'ready',
  );
  assert.equal(context.PasswordGeneratorV2PendingWordlists, undefined);
});

test('runtime build returns runtime, analyzer, and exactly ten wordlists', async () => {
  const outputFiles = await buildV2Runtime();
  const basenames = outputFiles.map((filePath) => filePath.split('/').at(-1));

  assert.equal(basenames.includes('runtime.v2.min.js'), true);
  assert.equal(basenames.includes('zxcvbn-analyzer.v2.min.js'), true);
  assert.equal(basenames.filter((name) => name.endsWith('.v2.js')).length, 10);
  assert.equal(outputFiles.length, 12);
});
