import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

const projectRoot = new URL('../', import.meta.url);
const outputDirectory = new URL('assets/vendor/', projectRoot);
const outputFile = new URL('zxcvbn-analyzer.v2.min.js', outputDirectory);
const licenseSource = new URL('node_modules/@zxcvbn-ts/core/LICENSE.txt', projectRoot);
const licenseTarget = new URL('zxcvbn-LICENSE.txt', outputDirectory);

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [new URL('src/zxcvbn-analyzer.entry.mjs', projectRoot).pathname],
  outfile: outputFile.pathname,
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: false,
  target: ['es2020'],
  legalComments: 'none',
});
await copyFile(licenseSource, licenseTarget);
