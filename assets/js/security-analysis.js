(function attachPasswordSecurityRuntime(global) {
  'use strict';

  const SECONDS_PER_YEAR = 31557600;
  const LOG10_SECONDS_PER_YEAR = Math.log10(SECONDS_PER_YEAR);
  const ATTACK_MODELS = Object.freeze({
    online: Object.freeze({
      id: 'online',
      label: '在线限速攻击',
      guessesPerSecond: 100 / 3600,
      speedLabel: '100 次/小时',
      description: '网站存在登录限速、账号锁定、验证码或多因素认证。',
    }),
    slowHash: Object.freeze({
      id: 'slowHash',
      label: '慢速密码哈希',
      guessesPerSecond: 1e4,
      speedLabel: '10⁴ 次/秒',
      description: '用于 Argon2id、scrypt、bcrypt、PBKDF2 等慢速离线验证的示意估算。',
    }),
    fastOffline: Object.freeze({
      id: 'fastOffline',
      label: '快速离线哈希',
      guessesPerSecond: 1e10,
      speedLabel: '10¹⁰ 次/秒',
      description: '用于数据库泄露且采用快速哈希、攻击硬件高度并行的严苛估算。',
    }),
  });

  const STRENGTH_LEVELS = Object.freeze([
    Object.freeze({ level: 'L1', key: 'instant', label: '瞬间破解', minGuessBits: 0 }),
    Object.freeze({ level: 'L2', key: 'extremely-easy', label: '极易破解', minGuessBits: 20 }),
    Object.freeze({ level: 'L3', key: 'easy', label: '容易破解', minGuessBits: 32 }),
    Object.freeze({ level: 'L4', key: 'risky', label: '有一定风险', minGuessBits: 40 }),
    Object.freeze({ level: 'L5', key: 'hard', label: '较难破解', minGuessBits: 52 }),
    Object.freeze({ level: 'L6', key: 'very-hard', label: '很难破解', minGuessBits: 64 }),
    Object.freeze({ level: 'L7', key: 'extremely-hard', label: '极难破解', minGuessBits: 80 }),
    Object.freeze({ level: 'L8', key: 'practically-impossible', label: '几乎无法破解', minGuessBits: 112 }),
  ]);

  function normalizeBits(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function strengthFromGuessBits(bits) {
    const normalized = normalizeBits(bits);
    let index = 0;
    for (let cursor = 1; cursor < STRENGTH_LEVELS.length; cursor += 1) {
      if (normalized < STRENGTH_LEVELS[cursor].minGuessBits) break;
      index = cursor;
    }
    return Object.freeze({
      ...STRENGTH_LEVELS[index],
      index,
      progress: ((index + 1) / STRENGTH_LEVELS.length) * 100,
    });
  }

  function formatAttackTimeFromLog10(log10Seconds) {
    if (!Number.isFinite(log10Seconds)) return '无法估算';
    if (log10Seconds < 0) return '不足 1 秒';
    if (log10Seconds < Math.log10(60)) {
      return `约 ${Math.max(1, Math.round(10 ** log10Seconds))} 秒`;
    }
    if (log10Seconds < Math.log10(3600)) {
      return `约 ${Math.max(1, Math.round((10 ** log10Seconds) / 60))} 分钟`;
    }
    if (log10Seconds < Math.log10(86400)) {
      return `约 ${Math.max(1, Math.round((10 ** log10Seconds) / 3600))} 小时`;
    }
    if (log10Seconds < LOG10_SECONDS_PER_YEAR) {
      return `约 ${Math.max(1, Math.round((10 ** log10Seconds) / 86400))} 天`;
    }
    const log10Years = log10Seconds - LOG10_SECONDS_PER_YEAR;
    if (log10Years < 6) {
      const years = 10 ** log10Years;
      const digits = years < 10 ? 1 : 0;
      return `约 ${years.toLocaleString('zh-CN', { maximumFractionDigits: digits })} 年`;
    }
    return `约 10 的 ${log10Years.toFixed(1)} 次方年`;
  }

  function estimateAttackTimes(effectiveGuessBits) {
    const guessBits = normalizeBits(effectiveGuessBits);
    const log10Guesses = guessBits * Math.LOG10E * Math.LN2;
    return Object.freeze(Object.fromEntries(Object.entries(ATTACK_MODELS).map(([key, model]) => {
      const log10Seconds = log10Guesses - Math.log10(model.guessesPerSecond);
      const seconds = log10Seconds < 308 ? 10 ** log10Seconds : null;
      return [key, Object.freeze({
        ...model,
        seconds,
        log10Seconds,
        label: formatAttackTimeFromLog10(log10Seconds),
      })];
    })));
  }

  function formatGuessCount(guessBits) {
    const bits = normalizeBits(guessBits);
    if (bits <= 49) return Math.max(1, Math.round(2 ** bits)).toLocaleString('zh-CN');
    return `约 2 的 ${bits.toFixed(1)} 次方`;
  }

  function createAssessment({ theoreticalBits, patternGuesses = null } = {}) {
    const normalizedTheoreticalBits = normalizeBits(theoreticalBits);
    const theoreticalAverageGuessBits = Math.max(0, normalizedTheoreticalBits - 1);
    const normalizedPatternGuesses = Number(patternGuesses);
    const patternGuessBits = Number.isFinite(normalizedPatternGuesses) && normalizedPatternGuesses > 0
      ? Math.log2(Math.max(1, normalizedPatternGuesses))
      : null;
    const effectiveGuessBits = patternGuessBits === null
      ? theoreticalAverageGuessBits
      : Math.min(theoreticalAverageGuessBits, patternGuessBits);
    const finiteEffectiveGuesses = effectiveGuessBits < 1024 ? 2 ** effectiveGuessBits : null;
    const finiteTheoreticalGuesses = theoreticalAverageGuessBits < 1024
      ? 2 ** theoreticalAverageGuessBits
      : null;
    return Object.freeze({
      theoreticalBits: normalizedTheoreticalBits,
      theoreticalAverageGuessBits,
      theoreticalAverageGuesses: finiteTheoreticalGuesses,
      patternGuesses: patternGuessBits === null ? null : normalizedPatternGuesses,
      patternGuessBits,
      effectiveGuesses: finiteEffectiveGuesses,
      effectiveGuessBits,
      attackTimes: estimateAttackTimes(effectiveGuessBits),
      strength: strengthFromGuessBits(effectiveGuessBits),
    });
  }

  global.PasswordSecurityRuntime = Object.freeze({
    ATTACK_MODELS,
    STRENGTH_LEVELS,
    createAssessment,
    estimateAttackTimes,
    formatAttackTimeFromLog10,
    formatGuessCount,
    strengthFromGuessBits,
  });
})(globalThis);
