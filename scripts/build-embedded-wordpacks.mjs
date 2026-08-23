import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'assets/wordpacks/manifest.v1.json'), 'utf8'));
const packs = {};

for (const descriptor of manifest.packs) {
  const payload = JSON.parse(await readFile(path.join(root, 'assets/wordpacks', descriptor.path), 'utf8'));
  packs[descriptor.id] = {
    id: payload.id,
    label: payload.label,
    version: payload.version,
    locale: payload.locale,
    kind: payload.kind,
    count: payload.count,
    source: payload.source,
    descriptor: {
      id: descriptor.id,
      kind: descriptor.kind,
      count: descriptor.count,
      sha256: descriptor.sha256,
    },
    entries: payload.entries.map(entry => entry.word),
  };
}

const store = {
  version: manifest.version,
  generatedAt: manifest.generatedAt,
  totalUniqueCoreAndThemes: manifest.totalUniqueCoreAndThemes,
  packs,
};
const output = `(function (scope) { scope.EmbeddedWordPacksV1 = ${JSON.stringify(store)}; })(globalThis);\n`;
await writeFile(path.join(root, 'assets/js/embedded-word-packs.js'), output);
process.stdout.write(`已生成 file:// 兼容词包：${Object.keys(packs).length} 包，${Buffer.byteLength(output).toLocaleString('zh-CN')} bytes。\n`);
