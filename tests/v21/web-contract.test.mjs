import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('V2.1 使用独立入口和独立内容哈希资源，不覆盖 V2.0.1', async () => {
  const [page, buildScript, packageJson] = await Promise.all([
    read('src/v21/web/page.v21.html'),
    read('scripts/build-v21.mjs'),
    read('package.json'),
  ]);
  assert.match(page, /安全随机数据生成器 V2\.1/u);
  assert.match(page, /__V21_APP__/u);
  assert.match(page, /assets\/v2\.1/u);
  assert.match(buildScript, /index-2\.1\.html/u);
  assert.match(buildScript, /assets\/v2\.1/u);
  assert.doesNotMatch(buildScript, /writeFile\([^\n]*v2\.01\.html/u);
  assert.doesNotMatch(buildScript, /(?:app|page|password-worker|analytics-frame)\.v201/u);
  const metadata = JSON.parse(packageJson);
  assert.equal(metadata.version, '2.1.0');
  assert.equal(metadata.scripts['build:v21'], 'node scripts/build-v21.mjs');
  assert.equal(metadata.scripts['test:v21'], 'node --test tests/v21/*.test.mjs');
});

test('生成记录位于生成结果底部并使用默认折叠的原生 details', async () => {
  const page = await read('src/v21/web/page.v21.html');
  const resultPanelStart = page.indexOf('<section class="panel result-panel"');
  const historyStart = page.indexOf('<details class="history-panel"');
  const resourceStripStart = page.indexOf('<div class="resource-strip"');
  assert.ok(resultPanelStart >= 0 && historyStart > resultPanelStart);
  assert.ok(resourceStripStart > historyStart);
  assert.match(page, /<details class="history-panel"[^>]*>/u);
  assert.doesNotMatch(page, /<details class="history-panel"[^>]*\sopen(?:\s|>)/u);
  assert.match(page, /<summary[^>]*>[\s\S]*生成记录 History/u);
});

test('密码配置提供复杂度、长度和生成数量三套完整控件', async () => {
  const [app, css] = await Promise.all([
    read('src/v21/web/app.v21.js'),
    read('src/v21/web/app.v21.css'),
  ]);
  for (const required of [
    '按照复杂度生成',
    "sliderShell\\(\\{ kind: 'complexity'",
    "sliderShell\\(\\{ kind: 'length'",
    "sliderShell\\(\\{ kind: 'quantity'",
    'class="preset-slider-range"',
    'data-preset-custom="complexity"',
    'data-preset-custom="\\$\\{kind\\}"',
    'data-complexity-level',
    'data-password-length-preset',
    'data-password-quantity-preset',
    'name="length" type="number"',
    'name="quantity" type="number"',
  ]) assert.match(app, new RegExp(required));
  assert.match(css, /\.preset-slider-control/u);
  assert.match(css, /\.preset-slider-range/u);
  assert.match(css, /\.preset-slider-mark/u);
  assert.match(css, /\.preset-exact-input/u);
  assert.doesNotMatch(app, /style="--(?:mark|preset|slider)-/u);
  assert.doesNotMatch(css, /\.complexity-grid/u);
  assert.doesNotMatch(css, /\.preset-number-control/u);
});

test('首屏不再渲染低价值的数字统计卡', async () => {
  const [page, css] = await Promise.all([
    read('src/v21/web/page.v21.html'),
    read('src/v21/web/app.v21.css'),
  ]);
  assert.doesNotMatch(page, /intro-proof/u);
  assert.doesNotMatch(css, /\.intro-proof/u);
});

test('V2.1 发布入口与 Pages 门禁同时覆盖新版本制品', async () => {
  const [workflow, sitemap, llms, readme, english] = await Promise.all([
    read('.github/workflows/v201-pages.yml'),
    read('sitemap.xml'),
    read('llms.txt'),
    read('README.md'),
    read('docs/readme-en.md'),
  ]);
  assert.match(workflow, /name:\s*V2\.1 security gate/u);
  assert.match(workflow, /npm run verify:v21/u);
  assert.match(workflow, /git diff --exit-code -- v2\.01\.html assets\/v2\.01 index-2\.1\.html assets\/v2\.1/u);
  assert.match(workflow, /cp index\.html index-2\.0\.html v2\.01\.html index-2\.1\.html _site\//u);
  assert.match(sitemap, /https:\/\/betaer\.github\.io\/password-generator\/index-2\.1\.html/u);
  assert.match(llms, /V2\.1：https:\/\/betaer\.github\.io\/password-generator\/index-2\.1\.html/u);
  assert.match(readme, /^# Security Random Generator V2\.1/mu);
  assert.match(readme, /在线使用 V2\.1[^\n]*index-2\.1\.html/u);
  assert.match(readme, /npm run verify:v21/u);
  assert.match(english, /^# Security Random Generator V2\.1/mu);
  assert.match(english, /Use V2\.1[^\n]*index-2\.1\.html/u);
  assert.match(english, /npm run verify:v21/u);
});
