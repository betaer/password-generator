'use strict';
importScripts('./runtime.v2.min.js');

self.onmessage = ({ data }) => {
  try {
    const result = self.PasswordGeneratorV2.password.generatePassword(data.config);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
