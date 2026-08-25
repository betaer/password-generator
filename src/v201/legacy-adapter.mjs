import { createIntegerSearchSpace } from './probability-contract.mjs';
import { createGenerationResult } from './result-model.mjs';

const PROFILE_BY_TYPE = Object.freeze({
  password: 'password',
  passphrase: 'passphrase',
  pin: 'pin',
  token: 'token',
  'api-secret': 'api-secret',
  uuid: 'uuid',
  hex: 'hex',
  'random-bytes': 'random-bytes',
  mnemonic: 'bip39',
});

export function upgradeLegacyResult(result, { extraConfig = {}, extraModel = {} } = {}) {
  if (!result || typeof result !== 'object' || typeof result.type !== 'string') {
    throw new TypeError('legacy result is required');
  }
  const legacy = result.generationModel;
  if (!legacy || typeof legacy.searchSpace !== 'bigint') throw new TypeError('legacy result lacks a search space');
  const profile = PROFILE_BY_TYPE[result.type];
  if (!profile) throw new RangeError(`unsupported legacy type: ${result.type}`);
  const minBits = legacy.minEntropyBits;
  const nominalBits = ['token', 'api-secret', 'uuid', 'hex', 'random-bytes'].includes(result.type)
    ? (legacy.randomBits ?? minBits)
    : undefined;
  return createGenerationResult({
    type: result.type,
    schemeId: `${result.schemeId}-v201`,
    value: result.value,
    ...(result.bytes instanceof Uint8Array ? { bytes: result.bytes } : {}),
    createdAt: result.createdAt,
    configSnapshot: { ...result.configSnapshot, ...extraConfig },
    generationModel: {
      searchSpace: createIntegerSearchSpace(legacy.searchSpace),
      generatorMinEntropyBits: minBits,
      generatorShannonEntropyBits: legacy.shannonEntropyBits ?? minBits,
      ...(nominalBits === undefined ? {} : { nominalCsprngOutputBits: nominalBits }),
      ...(Number.isSafeInteger(legacy.randomByteLength)
        ? { randomSourceBytesRequested: legacy.randomByteLength }
        : {}),
      randomSourceConsumptionModel: legacy.randomByteLength
        ? 'fixed-byte-request-with-format-bits'
        : 'constraint-aware-exact-uniform-sampler',
      presentationProfile: profile,
      alphabet: legacy.alphabet ?? null,
      poolSizes: legacy.poolSizes ?? null,
      encoding: legacy.encoding ?? null,
      prefix: legacy.prefix ?? '',
      standard: legacy.standard ?? null,
      ...extraModel,
    },
  });
}

