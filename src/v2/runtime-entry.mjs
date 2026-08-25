import * as randomModule from './random-core.mjs';
import * as combinatoricsModule from './combinatorics.mjs';
import * as resultsModule from './result-model.mjs';
import * as passwordModule from './password-model.mjs';
import * as passphraseModule from './passphrase-model.mjs';
import * as pinModule from './pin-model.mjs';
import * as byteSecretsModule from './byte-secret-models.mjs';
import * as uuidModule from './uuid-model.mjs';
import * as bip39Module from './bip39-model.mjs';
import * as assessmentModule from './security-assessment.mjs';

export const RUNTIME_VERSION = '2.0.0';

function freezeModule(moduleNamespace) {
  return Object.freeze({ ...moduleNamespace });
}

const runtime = Object.freeze({
  random: freezeModule(randomModule),
  combinatorics: freezeModule(combinatoricsModule),
  results: freezeModule(resultsModule),
  password: freezeModule(passwordModule),
  passphrase: freezeModule(passphraseModule),
  pin: freezeModule(pinModule),
  byteSecrets: freezeModule(byteSecretsModule),
  uuid: freezeModule(uuidModule),
  bip39: freezeModule(bip39Module),
  assessment: freezeModule(assessmentModule),
});

export function drainPendingBip39Wordlists() {
  const pending = globalThis.PasswordGeneratorV2PendingWordlists;
  if (!Array.isArray(pending) || pending.length === 0) return;

  const queuedWordlists = pending.splice(0, pending.length);
  for (const entry of queuedWordlists) {
    runtime.bip39.registerBip39Wordlist(entry.language, entry.words);
  }
}

globalThis.PasswordGeneratorV2 = runtime;
drainPendingBip39Wordlists();

export { runtime };
export default runtime;
