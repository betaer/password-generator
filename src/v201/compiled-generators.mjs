import {
  createPasswordModel,
  generatePasswordFromModel,
} from '../v2/password-model.mjs';
import {
  createPassphraseModel,
  generatePassphraseFromModel,
} from '../v2/passphrase-model.mjs';
import {
  createPinModel,
  generatePinFromModel,
} from '../v2/pin-model.mjs';
import {
  generateHex,
  generateToken,
} from '../v2/byte-secret-models.mjs';
import { generateUuidV4, generateUuidV7 } from '../v2/uuid-model.mjs';
import { generateApiSecret } from './api-secret.mjs';
import { generateMnemonic } from './bip39-model.mjs';
import { createIntegerSearchSpace } from './probability-contract.mjs';
import { createGenerationResult, clearGenerationResult } from './result-model.mjs';
import { generateLazyRandomBytes } from './random-bytes.mjs';
import {
  describePinPolicy,
  independentBatchCollisionProbability,
  sampleUniquePinBatch,
} from './pin-batch.mjs';
import { upgradeLegacyResult } from './legacy-adapter.mjs';

function freezeCompiled(value) {
  return Object.freeze(value);
}

function assertBatchQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new RangeError('quantity must be between 1 and 100');
}

async function sampleLoop(quantity, sampleOne) {
  assertBatchQuantity(quantity);
  const results = [];
  try {
    // 顺序采样限制峰值内存；失败时没有脱离本批次的在途结果。
    for (let index = 0; index < quantity; index += 1) results.push(await sampleOne(index));
    return results;
  } catch (error) {
    for (const result of results) clearGenerationResult(result);
    throw error;
  }
}

function pinResult(model, value, config, policy, collisionProbability) {
  return createGenerationResult({
    type: 'pin',
    schemeId: 'uniform-constrained-pin-v201',
    value,
    configSnapshot: {
      ...model.configSnapshot,
      uniqueWithinBatch: config.uniqueWithinBatch !== false,
    },
    generationModel: {
      searchSpace: createIntegerSearchSpace(model.searchSpace),
      generatorMinEntropyBits: model.minEntropyBits,
      generatorShannonEntropyBits: model.shannonEntropyBits,
      randomSourceConsumptionModel: 'completion-count-weighted-or-exact-unrank',
      presentationProfile: 'pin',
      baseSearchSpace: model.baseSearchSpace,
      blockedCount: model.blockedCount,
      riskVersion: model.riskVersion,
      independentBatchCollisionProbability: collisionProbability,
      ...(policy ? { commonPinPolicy: policy } : {}),
    },
  });
}

export async function compileGenerator(mode, config, dependencies = {}) {
  const cryptoLike = dependencies.cryptoLike ?? globalThis.crypto;
  const pinRiskIndex = dependencies.pinRiskIndex;
  switch (mode) {
    case 'password': {
      const model = createPasswordModel(config);
      const sampleOne = () => upgradeLegacyResult(generatePasswordFromModel(model, cryptoLike));
      return freezeCompiled({ mode, model, sampleOne, sampleBatch: (quantity) => sampleLoop(quantity, sampleOne) });
    }
    case 'passphrase': {
      const model = createPassphraseModel(config);
      const sampleOne = () => upgradeLegacyResult(generatePassphraseFromModel(model, cryptoLike), {
        extraModel: config.provenance ?? {},
      });
      return freezeCompiled({ mode, model, sampleOne, sampleBatch: (quantity) => sampleLoop(quantity, sampleOne) });
    }
    case 'pin': {
      const model = createPinModel(config, pinRiskIndex);
      const policy = config.blockWeak ? describePinPolicy(model, pinRiskIndex) : null;
      const sampleOne = (collision = 0) => pinResult(model, generatePinFromModel(model, cryptoLike).value, config, policy, collision);
      const sampleBatch = async (quantity) => {
        assertBatchQuantity(quantity);
        const collision = independentBatchCollisionProbability(model.searchSpace, quantity);
        if (quantity > 1 && config.uniqueWithinBatch !== false) {
          return sampleUniquePinBatch(model, quantity, cryptoLike)
            .map((value) => pinResult(model, value, config, policy, collision));
        }
        return sampleLoop(quantity, () => sampleOne(collision));
      };
      return freezeCompiled({ mode, model, sampleOne, sampleBatch });
    }
    case 'token': {
      const sampleOne = () => upgradeLegacyResult(generateToken(config, cryptoLike));
      return freezeCompiled({ mode, model: Object.freeze({ ...config }), sampleOne, sampleBatch: (quantity) => sampleLoop(quantity, sampleOne) });
    }
    case 'apiSecret': {
      const sampleOne = () => generateApiSecret(config, cryptoLike);
      return freezeCompiled({ mode, model: Object.freeze({ ...config }), sampleOne, sampleBatch: (quantity) => sampleLoop(quantity, sampleOne) });
    }
    case 'uuid': {
      const sampleOne = () => upgradeLegacyResult(
        config.version === 7 ? generateUuidV7(config, cryptoLike) : generateUuidV4(config, cryptoLike),
      );
      return freezeCompiled({ mode, model: Object.freeze({ ...config }), sampleOne, sampleBatch: (quantity) => sampleLoop(quantity, sampleOne) });
    }
    case 'hex': {
      const sampleOne = () => upgradeLegacyResult(generateHex(config, cryptoLike));
      return freezeCompiled({ mode, model: Object.freeze({ ...config }), sampleOne, sampleBatch: (quantity) => sampleLoop(quantity, sampleOne) });
    }
    case 'randomBytes': {
      const sampleOne = () => generateLazyRandomBytes(config, cryptoLike);
      return freezeCompiled({ mode, model: Object.freeze({ ...config }), sampleOne, sampleBatch: (quantity) => sampleLoop(quantity, sampleOne) });
    }
    case 'mnemonic': {
      const sampleOne = () => generateMnemonic(config, cryptoLike);
      return freezeCompiled({ mode, model: Object.freeze({ ...config }), sampleOne, sampleBatch: (quantity) => sampleLoop(quantity, sampleOne) });
    }
    default:
      throw new RangeError(`unsupported generation mode: ${String(mode)}`);
  }
}
