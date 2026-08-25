import {
  expectedRankForSearchSpace,
  formatExpectedRank,
  formatSearchSpace,
} from './probability-contract.mjs';

export const ASSESSMENT_PROFILES = Object.freeze({
  password: 'password',
  passphrase: 'passphrase',
  pin: 'pin',
  token: 'token',
  'api-secret': 'api-secret',
  hex: 'hex',
  'random-bytes': 'random-bytes',
  uuid: 'uuid',
  bip39: 'bip39',
});

const PASSWORD_ATTACK_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'online-rate-limited', label: '在线限速估算', guessesPerSecond: 100 / 3600, assumption: '100 次/小时；实际取决于限速、锁定与 MFA。' }),
  Object.freeze({ id: 'slow-kdf', label: '慢速 KDF 估算', guessesPerSecond: 1e4, assumption: '10⁴ 次/秒；实际取决于 Argon2id/bcrypt/scrypt/PBKDF2 参数和硬件。' }),
  Object.freeze({ id: 'fast-offline', label: '快速离线估算', guessesPerSecond: 1e10, assumption: '10¹⁰ 次/秒；仅适用于快速验证函数被离线攻击的假设。' }),
]);

const PIN_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'device-attempt-policy', label: '设备尝试策略', guessesPerSecond: null, assumption: '由设备重试次数、退避、锁定和擦除策略决定。' }),
]);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function requireBits(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
  return value;
}

function exactGenerator(generationModel) {
  const expectedRank = generationModel.expectedRank
    ?? expectedRankForSearchSpace(generationModel.searchSpace);
  return freeze({
    label: '精确生成器指标',
    searchSpace: generationModel.searchSpace,
    searchSpaceLabel: formatSearchSpace(generationModel.searchSpace),
    generatorMinEntropyBits: requireBits(generationModel.generatorMinEntropyBits, 'generatorMinEntropyBits'),
    generatorShannonEntropyBits: requireBits(
      generationModel.generatorShannonEntropyBits ?? generationModel.generatorMinEntropyBits,
      'generatorShannonEntropyBits',
    ),
    expectedRank,
    expectedRankLabel: formatExpectedRank(expectedRank),
  });
}

function normalizePattern(patternAnalysis) {
  if (!patternAnalysis) return Object.freeze({
    label: '观察模式估算', status: 'idle', guessBits: null, sequences: [],
  });
  const status = String(patternAnalysis.status ?? 'idle');
  const guessBits = patternAnalysis.guessBits === null || patternAnalysis.guessBits === undefined
    ? null
    : requireBits(patternAnalysis.guessBits, 'patternAnalysis.guessBits');
  const sequences = Array.isArray(patternAnalysis.sequences)
    ? patternAnalysis.sequences.map(String)
    : [];
  return freeze({ label: '观察模式估算', status, guessBits, sequences });
}

export function createSecurityAssessment({ generationModel, patternAnalysis = null } = {}) {
  if (!generationModel || typeof generationModel !== 'object') throw new TypeError('generationModel is required');
  const profile = generationModel.presentationProfile;
  if (!Object.values(ASSESSMENT_PROFILES).includes(profile)) {
    throw new RangeError(`unsupported assessment profile: ${String(profile)}`);
  }

  const exact = exactGenerator(generationModel);
  const isPassword = profile === 'password' || profile === 'passphrase';
  const isMachineSecret = ['token', 'api-secret', 'hex'].includes(profile);
  const assessment = {
    profile,
    exactGenerator: exact,
    observedPattern: isPassword ? normalizePattern(patternAnalysis) : null,
    attackScenarios: isPassword
      ? PASSWORD_ATTACK_SCENARIOS
      : profile === 'pin' ? PIN_SCENARIOS : Object.freeze([]),
    disclaimer: isPassword || profile === 'pin'
      ? '攻击场景基于明确速率、锁定与验证函数假设，仅为估算，不是安全保证。'
      : '生成器指标基于已记录的生成模型与 CSPRNG 均匀输出假设。',
  };

  if (isMachineSecret) {
    assessment.machineSecret = freeze({
      nominalCsprngOutputBits: requireBits(
        generationModel.nominalCsprngOutputBits ?? generationModel.generatorMinEntropyBits,
        'nominalCsprngOutputBits',
      ),
      collisionSemantics: '碰撞概率取决于发行数量与随机空间，不使用密码字典模型。',
    });
  }
  if (profile === 'random-bytes') {
    assessment.randomBytes = freeze({
      nominalCsprngOutputBits: requireBits(
        generationModel.nominalCsprngOutputBits ?? generationModel.generatorMinEntropyBits,
        'nominalCsprngOutputBits',
      ),
    });
  }
  if (profile === 'uuid') assessment.identifierNotice = 'Identifier, not a secret';
  if (profile === 'bip39') assessment.bip39Notice = '真实资产优先使用硬件钱包或经过验证的离线构建。';
  return freeze(assessment);
}

