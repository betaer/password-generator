import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common';

const analyzer = new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs });

export const ANALYZER_VERSION = 'zxcvbn-ts-common-v2';

function normalizeGuesses(value) {
  const guesses = Number(value);
  return Number.isFinite(guesses) && guesses >= 1 ? guesses : 1;
}

export function analyzePassword(value) {
  const result = analyzer.check(String(value ?? ''));
  const guesses = normalizeGuesses(result.guesses);
  const patterns = Object.freeze([
    ...new Set(result.sequence
      .map(({ pattern }) => String(pattern || 'unknown'))
      .filter((pattern) => pattern !== 'bruteforce')),
  ]);

  return Object.freeze({
    guesses,
    patternGuesses: patterns.length > 0 ? guesses : null,
    patterns,
  });
}

export const zxcvbnRuntime = Object.freeze({
  version: ANALYZER_VERSION,
  analyzePassword,
});

globalThis.PasswordGeneratorV2Zxcvbn = zxcvbnRuntime;

export default zxcvbnRuntime;
