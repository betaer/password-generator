import { MAX_ANALYZER_CHARACTERS } from './resource-budget.mjs';

function normalizeAnalysis(analysis) {
  const rawGuesses = analysis?.patternGuesses;
  const patternGuesses = typeof rawGuesses === 'bigint'
    ? rawGuesses
    : Number.isFinite(Number(rawGuesses)) && Number(rawGuesses) >= 1
      ? Number(rawGuesses)
      : null;
  const rawSequence = Array.isArray(analysis?.sequence)
    ? analysis.sequence
    : Array.isArray(analysis?.patterns)
      ? analysis.patterns.map((pattern) => ({ pattern }))
      : [];
  const sequences = [...new Set(rawSequence
    .map((entry) => String(entry?.pattern ?? entry ?? 'unknown'))
    .filter((pattern) => pattern && pattern !== 'bruteforce'))];
  let guessBits = null;
  if (typeof patternGuesses === 'bigint' && patternGuesses > 0n) {
    const bitLength = patternGuesses.toString(2).length;
    const shift = Math.max(0, bitLength - 53);
    guessBits = Math.log2(Number(patternGuesses >> BigInt(shift))) + shift;
  } else if (typeof patternGuesses === 'number') {
    guessBits = Math.log2(patternGuesses);
  }
  return Object.freeze({
    status: 'ready',
    guessBits,
    sequences: Object.freeze(sequences),
  });
}

export function createPatternAnalysisCoordinator(options = {}) {
  let analyzer = typeof options.analyze === 'function' ? options.analyze : null;
  let queue = Promise.resolve();

  const analyze = (results, { epoch, isLive, onUpdate }) => {
    if (!Array.isArray(results)) throw new TypeError('results must be an array');
    if (typeof isLive !== 'function' || typeof onUpdate !== 'function') {
      throw new TypeError('isLive and onUpdate must be functions');
    }
    if (!analyzer) return Promise.resolve(false);
    const task = async () => {
      for (const result of results) {
        if (!result || !['password', 'passphrase'].includes(result.type) || !isLive(result.id, epoch)) continue;
        let analysis;
        try {
          analysis = normalizeAnalysis(await analyzer(String(result.value ?? '').slice(0, MAX_ANALYZER_CHARACTERS)));
        } catch {
          // 不把可能含秘密的分析器错误对象带入结果、DOM 或日志。
          analysis = Object.freeze({ status: 'error', guessBits: null, sequences: Object.freeze([]) });
        }
        if (!isLive(result.id, epoch)) continue;
        onUpdate(result.id, analysis, epoch);
      }
      return true;
    };
    const pending = queue.then(task, task);
    queue = pending.then(() => undefined, () => undefined);
    return pending;
  };

  return Object.freeze({
    setAnalyzer(nextAnalyzer) {
      if (typeof nextAnalyzer !== 'function') throw new TypeError('analyzer must be a function');
      analyzer = nextAnalyzer;
    },
    analyze,
    async reanalyzeLive({ current = [], history = [], epoch, isLive, onUpdate }) {
      if (!analyzer) return false;
      const unique = new Map();
      for (const result of [...current, ...history]) unique.set(result.id, result);
      return analyze([...unique.values()], { epoch, isLive, onUpdate });
    },
    get ready() { return Boolean(analyzer); },
  });
}
