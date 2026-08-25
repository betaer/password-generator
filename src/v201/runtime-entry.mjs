import * as probability from './probability-contract.mjs';
import * as results from './result-model.mjs';
import * as assessment from './security-assessment.mjs';
import * as jobs from './generation-job.mjs';
import * as batch from './batch-generator.mjs';
import * as budgets from './resource-budget.mjs';
import * as randomBytes from './random-bytes.mjs';
import * as pinBatch from './pin-batch.mjs';
import * as passphraseAssets from './passphrase-assets.mjs';
import * as bip39 from './bip39-model.mjs';
import * as patternAnalysis from './zxcvbn-coordinator.mjs';
import * as inputValidation from './input-validation.mjs';
import { compileGenerator } from './compiled-generators.mjs';
import { createPinRiskIndex } from '../v2/pin-model.mjs';
import { getCompatiblePassphraseWords } from '../v2/passphrase-model.mjs';
import { createBinaryDownload, formatExistingBytes } from '../v2/byte-secret-models.mjs';

export const RUNTIME_VERSION = '2.0.1';

function freezeModule(namespace) {
  return Object.freeze({ ...namespace });
}

export const runtime = Object.freeze({
  version: RUNTIME_VERSION,
  probability: freezeModule(probability),
  results: freezeModule(results),
  assessment: freezeModule(assessment),
  jobs: freezeModule(jobs),
  batch: freezeModule(batch),
  budgets: freezeModule(budgets),
  randomBytes: freezeModule(randomBytes),
  pinBatch: freezeModule(pinBatch),
  passphraseAssets: freezeModule(passphraseAssets),
  bip39: freezeModule(bip39),
  patternAnalysis: freezeModule(patternAnalysis),
  inputValidation: freezeModule(inputValidation),
  compileGenerator,
  createPinRiskIndex,
  getCompatiblePassphraseWords,
  createBinaryDownload,
  formatExistingBytes,
});

globalThis.PasswordGeneratorV201 = runtime;

export default runtime;
