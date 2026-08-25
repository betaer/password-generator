export const RESOURCE_STATUSES = Object.freeze(['idle', 'loading', 'ready', 'degraded', 'error']);

export const ATTACK_MODELS = Object.freeze({
  online: Object.freeze({
    id: 'online',
    label: '在线限速攻击',
    guessesPerSecond: 100 / 3600,
    speedLabel: '100 次/小时',
  }),
  slowHash: Object.freeze({
    id: 'slowHash',
    label: '慢速密码哈希',
    guessesPerSecond: 1e4,
    speedLabel: '10⁴ 次/秒',
  }),
  fastOffline: Object.freeze({
    id: 'fastOffline',
    label: '快速离线哈希',
    guessesPerSecond: 1e10,
    speedLabel: '10¹⁰ 次/秒',
  }),
});

export const STRENGTH_LEVELS = Object.freeze([
  Object.freeze({ index: 0, level: 'L1', minGuessBits: 0, label: '瞬间破解', color: '#c62828', advice: '不要用于任何账号或秘密。' }),
  Object.freeze({ index: 1, level: 'L2', minGuessBits: 20, label: '极易破解', color: '#c2410c', advice: '请增加随机空间并避免常见模式。' }),
  Object.freeze({ index: 2, level: 'L3', minGuessBits: 32, label: '容易破解', color: '#b35c00', advice: '不建议用于邮箱、支付或后台账号。' }),
  Object.freeze({ index: 3, level: 'L4', minGuessBits: 40, label: '有一定风险', color: '#876400', advice: '重要用途仍应继续增加随机强度。' }),
  Object.freeze({ index: 4, level: 'L5', minGuessBits: 52, label: '较难破解', color: '#4d7c0f', advice: '请继续保证每个账号使用唯一秘密。' }),
  Object.freeze({ index: 5, level: 'L6', minGuessBits: 64, label: '很难破解', color: '#15803d', advice: '请妥善保存并防止泄露。' }),
  Object.freeze({ index: 6, level: 'L7', minGuessBits: 80, label: '极难破解', color: '#0f766e', advice: '实际风险主要转向保存、终端和泄露。' }),
  Object.freeze({ index: 7, level: 'L8', minGuessBits: 112, label: '几乎无法穷举', color: '#1d4ed8', advice: '请重点防止泄露、钓鱼、丢失和重复使用。' }),
]);

const PATTERN_MESSAGES = Object.freeze({
  idle: '尚未加载安全分析',
  loading: '安全分析正在加载',
  degraded: '部分安全分析不可用，当前显示生成器精确熵',
  error: '安全分析加载失败，当前只显示生成器精确熵',
});

function finiteBits(value, label) {
  const bits = Number(value);
  if (!Number.isFinite(bits) || bits < 0) throw new RangeError(`${label}必须是非负有限数值。`);
  return bits;
}

function freezeRecord(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezeRecord(item);
  return Object.freeze(value);
}

export function createResourceState(status, detail = '') {
  if (!RESOURCE_STATUSES.includes(status)) throw new RangeError(`未知资源状态：${status}`);
  return Object.freeze({ status, detail: String(detail || '') });
}

function patternGuessBits(patternAnalysis) {
  if (patternAnalysis.status !== 'ready') return null;
  if (Number.isFinite(patternAnalysis.patternGuessBits) && patternAnalysis.patternGuessBits >= 0) {
    return Number(patternAnalysis.patternGuessBits);
  }
  if (typeof patternAnalysis.guesses === 'bigint' && patternAnalysis.guesses > 0n) {
    const bitLength = patternAnalysis.guesses.toString(2).length;
    const shift = Math.max(0, bitLength - 53);
    const mantissa = Number(patternAnalysis.guesses >> BigInt(shift));
    return Math.log2(mantissa) + shift;
  }
  if (Number.isFinite(patternAnalysis.guesses) && patternAnalysis.guesses > 0) {
    return Math.log2(patternAnalysis.guesses);
  }
  return null;
}

function strengthFor(bits) {
  let selected = STRENGTH_LEVELS[0];
  for (const level of STRENGTH_LEVELS) {
    if (bits >= level.minGuessBits) selected = level;
  }
  return selected;
}

function formatDuration(log2Seconds) {
  if (!Number.isFinite(log2Seconds)) return '无法估算';
  if (log2Seconds < 0) return '不到 1 秒';
  const thresholds = [
    { seconds: 60, unit: '秒' },
    { seconds: 3600, unit: '分钟', divisor: 60 },
    { seconds: 86400, unit: '小时', divisor: 3600 },
    { seconds: 31557600, unit: '天', divisor: 86400 },
  ];
  for (const threshold of thresholds) {
    if (log2Seconds < Math.log2(threshold.seconds)) {
      const value = 2 ** log2Seconds / (threshold.divisor || 1);
      return `约 ${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${threshold.unit}`;
    }
  }
  const log10Years = log2Seconds * Math.LOG10E * Math.LN2 - Math.log10(31557600);
  if (log10Years < 6) {
    const years = 10 ** log10Years;
    return `约 ${years >= 10 ? years.toFixed(0) : years.toFixed(1)} 年`;
  }
  return `约 10 的 ${log10Years.toFixed(1)} 次方年`;
}

function attackTimes(effectiveGuessBits) {
  return freezeRecord(Object.fromEntries(Object.entries(ATTACK_MODELS).map(([key, model]) => {
    const log2Seconds = effectiveGuessBits - Math.log2(model.guessesPerSecond);
    return [key, {
      modelId: model.id,
      guessesPerSecond: model.guessesPerSecond,
      log2Seconds,
      label: formatDuration(log2Seconds),
    }];
  })));
}

function messageForPattern(patternAnalysis, bits) {
  if (patternAnalysis.status !== 'ready') return PATTERN_MESSAGES[patternAnalysis.status];
  if (bits === null) return '未发现常见模式';
  return '模式分析发现攻击者可能优先尝试的结构，已采用更保守的猜测次数';
}

export function createAssessment({ generationModel, patternAnalysis = { status: 'idle', guesses: null } }) {
  if (!generationModel || typeof generationModel !== 'object') throw new TypeError('缺少生成模型。');
  const status = patternAnalysis?.status || 'idle';
  createResourceState(status);
  const generatorMinEntropyBits = finiteBits(generationModel.minEntropyBits, 'Generator Min-Entropy');
  const generatorShannonEntropyBits = finiteBits(
    generationModel.shannonEntropyBits ?? generationModel.minEntropyBits,
    'Shannon Entropy',
  );
  const generatorAverageGuessBits = finiteBits(
    generationModel.averageGuessBits ?? Math.max(0, generatorMinEntropyBits - 1),
    '平均猜测次数',
  );
  const patternBits = patternGuessBits({ ...patternAnalysis, status });
  const effectiveGuessBits = patternBits === null
    ? generatorAverageGuessBits
    : Math.min(generatorAverageGuessBits, patternBits);
  const patterns = Array.isArray(patternAnalysis.patterns)
    ? Object.freeze(patternAnalysis.patterns.map((value) => String(value)))
    : Object.freeze([]);

  return freezeRecord({
    metricKind: 'generator',
    metricLabel: 'Generator Min-Entropy',
    generatorMinEntropyBits,
    generatorShannonEntropyBits,
    generatorAverageGuessBits,
    searchSpace: generationModel.searchSpace,
    patternStatus: status,
    patternGuessBits: patternBits,
    patternLimited: patternBits !== null && patternBits < generatorAverageGuessBits,
    patterns,
    patternMessage: messageForPattern({ ...patternAnalysis, status }, patternBits),
    effectiveGuessBits,
    strength: strengthFor(effectiveGuessBits),
    attackTimes: attackTimes(effectiveGuessBits),
    disclaimer: '这些结果是攻击模型估算，不是安全保证。',
  });
}

function smallestRepeatingUnit(value) {
  for (let width = 1; width <= Math.floor(value.length / 2); width += 1) {
    if (value.length % width === 0 && value.slice(0, width).repeat(value.length / width) === value) return width;
  }
  return value.length;
}

export function assessObservedInput(value, patternAnalysis = { status: 'idle', guesses: null }) {
  const text = String(value ?? '');
  const characters = [...text];
  const distinct = new Set(characters).size;
  const repeatingUnit = smallestRepeatingUnit(text);
  const compositionBits = characters.length && distinct
    ? characters.length * Math.log2(distinct)
    : 0;
  const repeatedBits = repeatingUnit < characters.length
    ? repeatingUnit * Math.log2(Math.max(1, distinct)) + Math.log2(characters.length / repeatingUnit + 1)
    : compositionBits;
  const observedEstimateBits = Math.max(0, Math.min(compositionBits, repeatedBits));
  const averageGuessBits = Math.max(0, observedEstimateBits - 1);
  const status = patternAnalysis?.status || 'idle';
  createResourceState(status);
  const patternBits = patternGuessBits({ ...patternAnalysis, status });
  const effectiveGuessBits = patternBits === null ? averageGuessBits : Math.min(averageGuessBits, patternBits);

  return freezeRecord({
    metricKind: 'observed',
    metricLabel: 'Observed Composition Estimate',
    observedEstimateBits,
    patternStatus: status,
    patternGuessBits: patternBits,
    patternMessage: messageForPattern({ ...patternAnalysis, status }, patternBits),
    effectiveGuessBits,
    strength: strengthFor(effectiveGuessBits),
    attackTimes: attackTimes(effectiveGuessBits),
    disclaimer: '观察组成估算无法证明未知字符串的真实生成分布。',
  });
}
