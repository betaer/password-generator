import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const v1 = await readFile(new URL('../../index-v1.75.html', import.meta.url), 'utf8');
const formal = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const v2App = await readFile(new URL('../../assets/v2/app.v2.js', import.meta.url), 'utf8');

test('V2.1 正式入口与 V1.7.5 归档隔离，V2 历史运行时仍可审计', () => {
  assert.match(v1, /V1\.7\.5/);
  assert.match(formal, /data-product-version="2\.1\.0"/);
  assert.match(v2App, /const SETTINGS_KEY = 'password-generator:v2:settings';/);
  assert.match(v2App, /const SETTINGS_SCHEMA_VERSION = 20;/);
  assert.doesNotMatch(v1, /password-generator:v2:settings/);
});
