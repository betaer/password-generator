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
  for (const pinnedAction of [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
    'actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0',
    'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2',
    'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0',
    'actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5.0.0',
  ]) assert.match(workflow, new RegExp(pinnedAction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(workflow, /uses:\s*actions\/[^@\s]+@v\d/u);
});

test('安全响应头样例明确说明 GitHub Pages 限制且不把 meta CSP 当作 frame-ancestors', async () => {
  const example = await readFile(new URL('docs/security-headers.v201.example', root), 'utf8');
  assert.match(example, /frame-ancestors 'none'/u);
  assert.match(example, /X-Frame-Options: DENY/u);
  assert.match(example, /X-Content-Type-Options: nosniff/u);
  assert.match(example, /Permissions-Policy:/u);
  assert.match(example, /GitHub Pages.*不会/u);
});
