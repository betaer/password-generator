import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const commit = '0e0329aa77f0f3d2ff5035e989ad320a2ac4a35d';
const baseURL = `https://raw.githubusercontent.com/danielmiessler/SecLists/${commit}/Passwords/Common-Credentials/`;
const sources = Object.freeze({
  fourDigit: Object.freeze({
    file: 'four-digit-pin-codes-sorted-by-frequency-withcount.csv',
    sha256: '18e0ebf05f5a9ab24dfd1d59cff979e931bc0dee8d0663008d6bd3e4b0fc320b',
  }),
  sixDigit: Object.freeze({
    file: 'xato-net-10-million-passwords-1000000.txt',
    sha256: '424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51',
  }),
});

async function download(source) {
  const url = `${baseURL}${source.file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);
  const text = await response.text();
  const digest = createHash('sha256').update(text).digest('hex');
  if (digest !== source.sha256) {
    throw new Error(`${source.file} 完整性校验失败：${digest}`);
  }
  return { text, url };
}

const [{ text: fourDigitText, url: fourDigitURL }, { text: sixDigitText, url: sixDigitURL }] = await Promise.all([
  download(sources.fourDigit),
  download(sources.sixDigit),
]);

const fourDigitRows = fourDigitText.trim().split(/\r?\n/).map((line) => line.split(',')[0].trim());
if (fourDigitRows.length !== 10000 || new Set(fourDigitRows).size !== 10000) {
  throw new Error(`4 位 PIN 数据应为 10,000 条唯一记录，实际为 ${fourDigitRows.length}。`);
}
const fourDigitRanks = new Uint16Array(10000);
fourDigitRows.forEach((pin, index) => {
  if (!/^\d{4}$/.test(pin)) throw new Error(`无效的 4 位 PIN：${pin}`);
  fourDigitRanks[Number(pin)] = index + 1;
});

const sixDigitRows = [];
const seenSixDigit = new Set();
for (const raw of sixDigitText.split(/\r?\n/)) {
  const pin = raw.trim();
  if (!/^\d{6}$/.test(pin) || seenSixDigit.has(pin)) continue;
  seenSixDigit.add(pin);
  sixDigitRows.push(pin);
}
if (sixDigitRows.length !== 68202) {
  throw new Error(`6 位 PIN 数据应为 68,202 条唯一记录，实际为 ${sixDigitRows.length}。`);
}
const sixDigitValues = new Uint32Array(sixDigitRows.map(Number));

const payload = {
  version: '1.0.0',
  generatedAt: new Date().toISOString(),
  metadata: {
    fourDigitCount: fourDigitRows.length,
    sixDigitCount: sixDigitRows.length,
    fourDigitBlockRank: 500,
    sixDigitBlockRank: 1000,
    sourceCommit: commit,
  },
  sources: {
    fourDigit: { url: fourDigitURL, sha256: sources.fourDigit.sha256 },
    sixDigit: { url: sixDigitURL, sha256: sources.sixDigit.sha256 },
  },
  encoding: 'little-endian-typed-array-base64',
  fourDigitRanks: Buffer.from(fourDigitRanks.buffer).toString('base64'),
  sixDigitValues: Buffer.from(sixDigitValues.buffer).toString('base64'),
};

const outputDirectory = new URL('../assets/data/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(new URL('pin-risk.v1.json', outputDirectory), `${JSON.stringify(payload)}\n`),
  writeFile(new URL('pin-risk-source.txt', outputDirectory), [
    'PIN risk corpus',
    `SecLists commit: ${commit}`,
    `4-digit source: ${fourDigitURL}`,
    `4-digit sha256: ${sources.fourDigit.sha256}`,
    `4-digit records: ${fourDigitRows.length}`,
    `6-digit source: ${sixDigitURL}`,
    `6-digit sha256: ${sources.sixDigit.sha256}`,
    `6-digit numeric unique records: ${sixDigitRows.length}`,
    '',
    'This derived index stores PIN values/ranks only. It is used locally for defensive weak-PIN detection.',
    '',
  ].join('\n')),
]);

console.log(`已生成 PIN 风险库：4 位 ${fourDigitRows.length.toLocaleString()} 条，6 位 ${sixDigitRows.length.toLocaleString()} 条。`);
