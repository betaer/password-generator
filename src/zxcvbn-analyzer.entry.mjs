import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common';

const analyzer = new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs });

export const ANALYZER_VERSION = 'zxcvbn-ts-common-v2';

export function analyzePassword(value) {
  const result = analyzer.check(String(value ?? ''));
  const sequence = result.sequence.map(({ pattern, token }) => Object.freeze({
    pattern: String(pattern || 'unknown'),
    length: String(token || '').length,
  }));
  const hasPredictablePattern = sequence.some(({ pattern }) => pattern !== 'bruteforce');
  return Object.freeze({
    guesses: Math.max(1, Number(result.guesses) || 1),
    patternGuesses: hasPredictablePattern ? Math.max(1, Number(result.guesses) || 1) : null,
    score: Number.isInteger(result.score) ? result.score : 0,
    sequence: Object.freeze(sequence),
  });
}
