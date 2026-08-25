import { access, mkdir, writeFile } from 'node:fs/promises';
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

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const BIP39_PACKAGE_VERSION = '2.3.0';
const WORDLISTS = Object.freeze({
  czech,
  english,
  french,
  italian,
  japanese,
  korean,
  portuguese,
  'simplified-chinese': simplifiedChinese,
  spanish,
  'traditional-chinese': traditionalChinese,
});

function escapeJavaScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function requireOfficialWordlist(language, words) {
  if (!Array.isArray(words) || words.length !== 2048 || new Set(words).size !== 2048) {
    throw new Error(`Invalid official BIP39 wordlist: ${language}`);
  }
  if (words.some((word) => typeof word !== 'string' || word.normalize('NFKD') !== word)) {
    throw new Error(`Non-NFKD entry in official BIP39 wordlist: ${language}`);
  }
}

function createWordlistAsset(language, words) {
  requireOfficialWordlist(language, words);
  const serializedLanguage = escapeJavaScriptJson(language);
  const serializedWords = escapeJavaScriptJson(words);
  return `/* BIP39 ${language} wordlist | @scure/bip39 ${BIP39_PACKAGE_VERSION} | MIT */\n(function registerBip39Asset(root) {\n  'use strict';\n  var language = ${serializedLanguage};\n  var words = Object.freeze(${serializedWords});\n  var marker = Object.freeze({ language: language, version: 'bip39@${BIP39_PACKAGE_VERSION}', wordCount: words.length });\n  var assets = root.PasswordGeneratorV2Bip39Assets;\n  if (!assets || typeof assets !== 'object') {\n    assets = Object.create(null);\n    root.PasswordGeneratorV2Bip39Assets = assets;\n  }\n  assets[language] = marker;\n  if (root.PasswordGeneratorV2 && typeof root.PasswordGeneratorV2.registerBip39Wordlist === 'function') {\n    root.PasswordGeneratorV2.registerBip39Wordlist(language, words);\n    return;\n  }\n  var pending = root.PasswordGeneratorV2PendingWordlists;\n  if (!Array.isArray(pending)) {\n    pending = [];\n    root.PasswordGeneratorV2PendingWordlists = pending;\n  }\n  pending.push(Object.freeze({ language: language, version: marker.version, words: words }));\n})(globalThis);\n`;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function bundleReproducibly({ entryPoint, globalName, outputFile }) {
  const options = {
    entryPoints: [entryPoint],
    bundle: true,
    format: 'iife',
    globalName,
    legalComments: 'inline',
    minify: true,
    platform: 'browser',
    target: ['es2020'],
    write: false,
  };
  const [first, second] = await Promise.all([build(options), build(options)]);
  const firstBytes = first.outputFiles[0].contents;
  const secondBytes = second.outputFiles[0].contents;
  if (!Buffer.from(firstBytes).equals(Buffer.from(secondBytes))) {
    throw new Error(`Non-reproducible V2 bundle: ${path.basename(outputFile)}`);
  }
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, firstBytes);
  return outputFile;
}

export async function buildBip39Assets({
  outputDirectory = path.join(PROJECT_ROOT, 'assets/v2/bip39'),
} = {}) {
  await mkdir(outputDirectory, { recursive: true });
  const outputFiles = [];
  for (const [language, words] of Object.entries(WORDLISTS)) {
    const source = createWordlistAsset(language, words);
    if (source !== createWordlistAsset(language, words)) {
      throw new Error(`Non-reproducible BIP39 asset: ${language}`);
    }
    const outputFile = path.join(outputDirectory, `${language}.v2.js`);
    await writeFile(outputFile, source, 'utf8');
    outputFiles.push(outputFile);
  }
  return Object.freeze(outputFiles);
}

export async function buildRuntimeAssets({ projectRoot = PROJECT_ROOT } = {}) {
  const entryPoint = path.join(projectRoot, 'src/v2/runtime-entry.mjs');
  if (!(await pathExists(entryPoint))) {
    return Object.freeze([]);
  }
  const outputFile = path.join(projectRoot, 'assets/v2/runtime.v2.min.js');
  await bundleReproducibly({
    entryPoint,
    globalName: 'PasswordGeneratorV2',
    outputFile,
  });
  return Object.freeze([outputFile]);
}

export async function buildV2Runtime({ projectRoot = PROJECT_ROOT } = {}) {
  const [wordlistAssets, runtimeAssets] = await Promise.all([
    buildBip39Assets({ outputDirectory: path.join(projectRoot, 'assets/v2/bip39') }),
    buildRuntimeAssets({ projectRoot }),
  ]);
  return Object.freeze([...runtimeAssets, ...wordlistAssets]);
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  await buildV2Runtime();
}
