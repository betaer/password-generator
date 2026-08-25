import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import {
  ANALYZER_VERSION,
  analyzePassword,
  zxcvbnRuntime,
} from '../../src/v2/zxcvbn-entry.mjs';
import { createAssessment } from '../../src/v2/security-assessment.mjs';
import { buildZxcvbnAssets } from '../../scripts/build-v2-runtime.mjs';

test('zxcvbn exports one frozen local analyzer contract', () => {
  assert.equal(ANALYZER_VERSION, 'zxcvbn-ts-common-v2');
  assert.equal(Object.isFrozen(zxcvbnRuntime), true);
  assert.equal(globalThis.PasswordGeneratorV2Zxcvbn, zxcvbnRuntime);
  assert.deepEqual(Object.keys(zxcvbnRuntime).sort(), ['analyzePassword', 'version']);
});

test('analyzer output is deeply frozen and contains no plaintext tokens', () => {
  const plaintext = 'passwordpassword123';
  const result = analyzePassword(plaintext);

  assert.deepEqual(Object.keys(result).sort(), ['guesses', 'patternGuesses', 'patterns']);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.patterns), true);
  assert.equal(result.patternGuesses !== null, true);
  assert.equal(result.patterns.length > 0, true);
  assert.equal(result.patterns.every((pattern) => typeof pattern === 'string'), true);
  assert.equal(JSON.stringify(result).includes(plaintext), false);
  assert.equal(JSON.stringify(result).includes('passwordpassword'), false);
  assert.equal('token' in result, false);
  assert.equal('sequence' in result, false);
});

test('empty and null inputs remain sanitized valid analyzer requests', () => {
  for (const value of ['', null, undefined]) {
    const result = analyzePassword(value);
    assert.equal(Number.isFinite(result.guesses), true);
    assert.equal(result.guesses >= 1, true);
    assert.equal(result.patternGuesses === null || result.patternGuesses >= 1, true);
  }
});

test('ready zxcvbn output can only make a generator assessment more conservative', () => {
  const pattern = analyzePassword('passwordpassword123');
  const assessment = createAssessment({
    generationModel: {
      minEntropyBits: 128,
      shannonEntropyBits: 128,
      averageGuessBits: 127,
      searchSpace: 1n << 128n,
    },
    patternAnalysis: {
      status: 'ready',
      guesses: pattern.patternGuesses,
      patterns: pattern.patterns,
    },
  });

  assert.equal(assessment.generatorMinEntropyBits, 128);
  assert.equal(assessment.patternLimited, true);
  assert.equal(assessment.effectiveGuessBits < 127, true);
});

test('classic analyzer asset is deterministic, frozen, and does not expose secrets', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'password-generator-v2-zxcvbn-'));
  const outputFile = path.join(outputDirectory, 'zxcvbn-analyzer.v2.min.js');
  try {
    await buildZxcvbnAssets({ outputFile });
    const firstSource = await readFile(outputFile, 'utf8');
    await buildZxcvbnAssets({ outputFile });
    const secondSource = await readFile(outputFile, 'utf8');
    assert.equal(firstSource, secondSource);
    assert.doesNotMatch(firstSource, /^\s*(?:import|export)\s/m);
    assert.doesNotMatch(firstSource, /https?:\/\//u);

    const context = {};
    context.globalThis = context;
    vm.runInNewContext(firstSource, context, { filename: 'zxcvbn-analyzer.v2.min.js' });
    assert.equal(Object.isFrozen(context.PasswordGeneratorV2Zxcvbn), true);

    const plaintext = 'correct horse battery staple';
    const result = context.PasswordGeneratorV2Zxcvbn.analyzePassword(plaintext);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(JSON.stringify(result).includes(plaintext), false);
    assert.deepEqual(
      Object.keys(result).sort(),
      ['guesses', 'patternGuesses', 'patterns'],
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('analyzer builder reports an absent source entry without emitting an asset', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'password-generator-v2-zxcvbn-missing-'));
  try {
    assert.deepEqual(await buildZxcvbnAssets({ projectRoot }), []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
