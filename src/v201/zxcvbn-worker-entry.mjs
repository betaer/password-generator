import { analyzePassword } from '../v2/zxcvbn-entry.mjs';

self.onmessage = ({ data }) => {
  const requestId = data?.requestId;
  const epoch = data?.epoch;
  try {
    const value = String(data?.value ?? '').slice(0, 512);
    const analysis = analyzePassword(value);
    self.postMessage({
      ok: true,
      requestId,
      epoch,
      result: {
        patternGuesses: analysis.patternGuesses,
        sequence: analysis.patterns.map((pattern) => ({ pattern })),
      },
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      requestId,
      epoch,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

