import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const sourceUrl = new URL('assets/data/pin-risk.v1.json', root);
const outputUrl = new URL('assets/v2/pin-risk.v2.js', root);
const sourceText = await readFile(sourceUrl, 'utf8');
const payload = JSON.parse(sourceText);

if (payload.encoding !== 'little-endian-typed-array-base64'
  || payload.metadata?.fourDigitCount !== 10_000
  || payload.metadata?.sixDigitCount !== 68_202
  || typeof payload.sources?.fourDigit?.sha256 !== 'string'
  || typeof payload.sources?.sixDigit?.sha256 !== 'string') {
  throw new Error('PIN 风险源数据格式或审计计数无效。');
}

const sourceSha256 = createHash('sha256').update(sourceText).digest('hex');
const builtPayload = { ...payload, sourceSha256 };
const serialized = JSON.stringify(builtPayload).replaceAll('<', '\\u003c');
const output = `/* Password Generator V2 PIN risk asset. Generated; do not edit. */
(function installPinRiskAsset(root) {
  "use strict";
  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function freezeChild(key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }
  var assets = root.PasswordGeneratorV2Assets;
  if (!assets || typeof assets !== "object") {
    assets = {};
    root.PasswordGeneratorV2Assets = assets;
  }
  assets.pinRisk = deepFreeze(${serialized});
})(globalThis);
`;

await mkdir(new URL('assets/v2/', root), { recursive: true });
await writeFile(outputUrl, output, 'utf8');
console.log(`Built ${outputUrl.pathname} (${Buffer.byteLength(output)} bytes, source sha256 ${sourceSha256})`);
