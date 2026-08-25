import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const v1 = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const v2 = await readFile(new URL('../../index-2.0.html', import.meta.url), 'utf8');

test('V2 has an isolated entry and leaves the V1 marker intact', () => {
  assert.match(v1, /V1\.7\.5/);
  assert.match(v2, /V2\.0/);
  assert.match(v2, /const SETTINGS_KEY = 'password-generator:v2:settings';/);
  assert.match(v2, /const SETTINGS_SCHEMA_VERSION = 20;/);
  assert.doesNotMatch(v1, /password-generator:v2:settings/);
});
