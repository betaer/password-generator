import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { wordlist as czech } from '@scure/bip39/wordlists/czech.js';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import { wordlist as french } from '@scure/bip39/wordlists/french.js';
import { wordlist as italian } from '@scure/bip39/wordlists/italian.js';
import { wordlist as japanese } from '@scure/bip39/wordlists/japanese.js';
import { wordlist as korean } from '@scure/bip39/wordlists/korean.js';
import { wordlist as portuguese } from '@scure/bip39/wordlists/portuguese.js';
import { wordlist as simplifiedChinese } from '@scure/bip39/wordlists/simplified-chinese.js';
import { wordlist as spanish } from '@scure/bip39/wordlists/spanish.js';
import { wordlist as traditionalChinese } from '@scure/bip39/wordlists/traditional-chinese.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(projectRoot, 'assets/v2.1');
const sourceDirectory = path.join(projectRoot, 'src/v21/web');
const VERSION = '2.1.0';
const BIP39_VERSION = '2.3.0';
const wordlists = Object.freeze({
  czech, english, french, italian, japanese, korean, portuguese,
  'simplified-chinese': simplifiedChinese, spanish, 'traditional-chinese': traditionalChinese,
});

function sha256(value, encoding = 'hex') {
  return createHash('sha256').update(value).digest(encoding);
}

function hashedName(label, bytes, extension) {
  return `${label}.${sha256(bytes).slice(0, 12)}.${extension}`;
}

function javascriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

async function writeHashed(label, extension, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const filename = hashedName(label, body, extension);
  await writeFile(path.join(outputDirectory, filename), body);
  return filename;
}

async function bundle(entryPoint, options = {}) {
  const buildOptions = {
    entryPoints: [entryPoint], bundle: true, format: options.format ?? 'iife',
    globalName: options.globalName, footer: options.footer, define: options.define,
    legalComments: 'inline', minify: true, platform: 'browser', target: ['es2020'], write: false,
  };
  const [first, second] = await Promise.all([build(buildOptions), build(buildOptions)]);
  const firstBytes = Buffer.from(first.outputFiles[0].contents);
  const secondBytes = Buffer.from(second.outputFiles[0].contents);
  if (!firstBytes.equals(secondBytes)) throw new Error(`Non-reproducible bundle: ${entryPoint}`);
  return firstBytes;
}

async function buildRuntime() {
  const bytes = await bundle(path.join(projectRoot, 'src/v201/runtime-entry.mjs'), {
    globalName: 'PasswordGeneratorV201Bundle',
    footer: { js: 'globalThis.PasswordGeneratorV201 = PasswordGeneratorV201Bundle.runtime || PasswordGeneratorV201Bundle.default || globalThis.PasswordGeneratorV201;' },
  });
  return writeHashed('runtime', 'js', bytes);
}

async function buildBip39Assets() {
  const assets = {};
  for (const [language, words] of Object.entries(wordlists)) {
    if (words.length !== 2048 || new Set(words).size !== 2048) throw new Error(`Invalid BIP39 wordlist: ${language}`);
    const expected = sha256(words.join('\n'));
    const source = `/* BIP39 ${language} | @scure/bip39 ${BIP39_VERSION} | MIT */\n(function(root){'use strict';var language=${javascriptJson(language)};var words=Object.freeze(${javascriptJson(words)});var expected=${javascriptJson(expected)};var assets=root.PasswordGeneratorV201Bip39Assets||(root.PasswordGeneratorV201Bip39Assets=Object.create(null));assets[language]=Object.freeze({language:language,version:'bip39@${BIP39_VERSION}',wordCount:words.length,sha256:expected,ready:root.PasswordGeneratorV201.bip39.registerBip39Wordlist(language,words,expected)});})(globalThis);\n`;
    assets[language] = await writeHashed(`bip39.${language}`, 'js', source);
  }
  return Object.freeze(assets);
}

async function buildPassphraseAsset() {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'assets/wordpacks/manifest.v1.json'), 'utf8'));
  const packs = {};
  for (const descriptor of manifest.packs) {
    const payload = JSON.parse(await readFile(path.join(projectRoot, 'assets/wordpacks', descriptor.path), 'utf8'));
    const words = payload.entries.map((entry) => entry.word);
    const wordSha = sha256(words.join('\n'));
    packs[descriptor.id] = Object.freeze({ id: descriptor.id, label: descriptor.label, version: `v201-${descriptor.version}`, words, sha256: wordSha });
  }
  const source = `/* V2.1 independent passphrase packs; generated from audited source assets. */\n(function(root){'use strict';var raw=${javascriptJson(packs)};var packs=Object.create(null);var registrations=[];Object.keys(raw).forEach(function(id){var source=raw[id];var pack=Object.freeze({id:source.id,label:source.label,version:source.version,words:Object.freeze(source.words),sha256:source.sha256});packs[id]=pack;registrations.push(root.PasswordGeneratorV201.passphraseAssets.registerPassphrasePack(pack));});root.PasswordGeneratorV201PassphraseAssets=Object.freeze({version:'${VERSION}',packs:Object.freeze(packs),ready:Promise.all(registrations)});})(globalThis);\n`;
  return writeHashed('passphrase-packs', 'js', source);
}

async function buildPinRiskAsset() {
  const sourceText = await readFile(path.join(projectRoot, 'assets/data/pin-risk.v1.json'), 'utf8');
  const payload = JSON.parse(sourceText);
  if (payload.metadata?.fourDigitBlockRank !== 500 || payload.metadata?.sixDigitBlockRank !== 1000) throw new Error('Unexpected PIN policy thresholds');
  const built = { ...payload, sourceSha256: sha256(sourceText), policyName: 'Heuristic Common-PIN Exclusion Policy v1' };
  const source = `/* V2.1 PIN heuristic policy asset. */\n(function(root){'use strict';var assets=root.PasswordGeneratorV201Assets||(root.PasswordGeneratorV201Assets={});assets.pinRisk=Object.freeze(${javascriptJson(built)});})(globalThis);\n`;
  return writeHashed('pin-risk', 'js', source);
}

async function buildAnalyticsFrame() {
  let html = await readFile(path.join(sourceDirectory, 'analytics-frame.v21.html'), 'utf8');
  const match = html.match(/<script id="v21-analytics-config">([\s\S]*?)<\/script>/u);
  if (!match) throw new Error('Missing V2.1 analytics config script');
  const cspHash = `sha256-${sha256(match[1], 'base64')}`;
  html = html.replace('__V21_ANALYTICS_HASH__', cspHash);
  return writeHashed('analytics-frame', 'html', html);
}

async function buildPasswordWorker(runtimeFile) {
  const source = (await readFile(path.join(sourceDirectory, 'password-worker.v21.js'), 'utf8'))
    .replace('__V21_RUNTIME_FILE__', javascriptJson(runtimeFile));
  return writeHashed('password-worker', 'js', source);
}

async function buildPage(assets) {
  const replacements = {
    __V21_CSS__: assets.css,
    __V21_PASSWORD_WORKER__: assets.passwordWorker,
    __V21_ZXCVBN_WORKER__: assets.zxcvbnWorker,
    __V21_PASSPHRASE__: assets.passphrase,
    __V21_PIN_RISK__: assets.pinRisk,
    __V21_BIP39_ENGLISH__: assets.bip39.english,
    __V21_ANALYTICS_FRAME__: assets.analyticsFrame,
    __V21_RUNTIME__: assets.runtime,
    __V21_APP__: assets.app,
  };
  let html = await readFile(path.join(sourceDirectory, 'page.v21.html'), 'utf8');
  const structuredData = html.match(/<script id="v21-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/u);
  if (!structuredData) throw new Error('Missing V2.1 structured data script');
  html = html.replace('__V21_SEO_HASH__', `sha256-${sha256(structuredData[1], 'base64')}`);
  for (const [placeholder, value] of Object.entries(replacements)) html = html.replaceAll(placeholder, value);
  if (/__V21_[A-Z_]+__/u.test(html)) throw new Error('Unresolved V2.1 page placeholder');
  await writeFile(path.join(projectRoot, 'index.html'), html);

  const redirectScript = "location.replace(new URL('./index.html'+location.search+location.hash,location.href).href);";
  const redirectHash = `sha256-${sha256(redirectScript, 'base64')}`;
  const compatibilityAlias = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, follow" />
  <meta http-equiv="refresh" content="0; url=./index.html" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${redirectHash}'; base-uri 'none'; form-action 'none'" />
  <link rel="canonical" href="https://betaer.github.io/password-generator/index.html" />
  <title>正在进入安全随机数据生成器 V2.1</title>
</head>
<body>
  <p>V2.1 已成为正式版。正在跳转；如未自动跳转，请访问 <a href="./index.html">安全随机数据生成器</a>。</p>
  <script>${redirectScript}</script>
</body>
</html>
`;
  await writeFile(path.join(projectRoot, 'index-2.1.html'), compatibilityAlias);
}

export async function buildV21() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const runtime = await buildRuntime();
  const [zxcvbnWorker, bip39, passphrase, pinRisk, analyticsFrame, css] = await Promise.all([
    bundle(path.join(projectRoot, 'src/v201/zxcvbn-worker-entry.mjs')).then((bytes) => writeHashed('zxcvbn-worker', 'js', bytes)),
    buildBip39Assets(), buildPassphraseAsset(), buildPinRiskAsset(), buildAnalyticsFrame(),
    readFile(path.join(sourceDirectory, 'app.v21.css')).then((bytes) => writeHashed('app', 'css', bytes)),
  ]);
  const passwordWorker = await buildPasswordWorker(runtime);
  const appManifest = { version: VERSION, runtime, passwordWorker, zxcvbnWorker, passphrase, pinRisk, analyticsFrame, css, bip39 };
  const appBytes = await bundle(path.join(sourceDirectory, 'app.v21.js'), { define: { __V21_ASSET_MANIFEST__: JSON.stringify(appManifest) } });
  const app = await writeHashed('app', 'js', appBytes);
  const assets = Object.freeze({ ...appManifest, app });
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify({ version: VERSION, assets }, null, 2)}\n`);
  await buildPage(assets);
  return assets;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const assets = await buildV21();
  process.stdout.write(`Built V2.1: ${Object.keys(assets).length} asset groups\n`);
}
