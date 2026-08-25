import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('V2.0.1 Pages 发布必须经过完整安全门禁与可复现制品比对', async () => {
  const workflow = await readFile(new URL('.github/workflows/v201-pages.yml', root), 'utf8');
  for (const required of [
    'npm ci',
    'npm run verify:v201',
    'playwright install --with-deps chromium',
    'git diff --exit-code',
    'actions/upload-pages-artifact',
    'actions/deploy-pages',
    'actions/attest-build-provenance',
  ]) assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(workflow, /pull_request:[\s\S]*branches:\s*\[main\]/u);
  assert.match(workflow, /package:[\s\S]*needs:\s*verify/u);
  assert.match(workflow, /deploy:[\s\S]*needs:\s*package/u);
});

test('安全响应头样例明确说明 GitHub Pages 限制且不把 meta CSP 当作 frame-ancestors', async () => {
  const example = await readFile(new URL('docs/security-headers.v201.example', root), 'utf8');
  assert.match(example, /frame-ancestors 'none'/u);
  assert.match(example, /X-Frame-Options: DENY/u);
  assert.match(example, /X-Content-Type-Options: nosniff/u);
  assert.match(example, /Permissions-Policy:/u);
  assert.match(example, /GitHub Pages.*不会/u);
});
