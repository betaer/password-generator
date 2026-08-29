import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('发布路由只保留正式 V2.1、V1.7.5 归档与 V2.1 兼容跳转', async () => {
  const [formal, archive, alias] = await Promise.all([
    read('index.html'),
    read('index-v1.75.html'),
    read('index-2.1.html'),
  ]);
  assert.match(formal, /data-product-version="2\.1\.0"/u);
  assert.match(archive, /V1\.7\.5/u);
  assert.match(alias, /noindex, follow/u);
  assert.match(alias, /location\.replace/u);
  assert.match(alias, /href="\.\/index\.html"/u);
  await assert.rejects(access(new URL('index-2.0.html', root)), /ENOENT/u);
  await assert.rejects(access(new URL('v2.01.html', root)), /ENOENT/u);
  await assert.rejects(access(new URL('scripts/build-v201.mjs', root)), /ENOENT/u);
});

test('V2.1 构建正式入口、兼容跳转入口和独立内容哈希资源', async () => {
  const [page, buildScript, packageJson] = await Promise.all([
    read('src/v21/web/page.v21.html'),
    read('scripts/build-v21.mjs'),
    read('package.json'),
  ]);
  assert.match(page, /安全随机数据生成器 V2\.1/u);
  assert.match(page, /__V21_APP__/u);
  assert.match(page, /assets\/v2\.1/u);
  assert.match(buildScript, /index\.html/u);
  assert.match(buildScript, /index-2\.1\.html/u);
  assert.match(buildScript, /noindex, follow/u);
  assert.match(buildScript, /assets\/v2\.1/u);
  assert.doesNotMatch(buildScript, /writeFile\([^\n]*v2\.01\.html/u);
  assert.doesNotMatch(buildScript, /(?:app|page|password-worker|analytics-frame)\.v201/u);
  const metadata = JSON.parse(packageJson);
  assert.equal(metadata.version, '2.1.0');
  assert.equal(metadata.scripts['build:v21'], 'node scripts/build-v21.mjs');
  assert.equal(metadata.scripts['test:v21'], 'node --test tests/v21/*.test.mjs');
});

test('生成记录位于生成结果底部并使用默认折叠的原生 details', async () => {
  const [page, app, css] = await Promise.all([
    read('src/v21/web/page.v21.html'),
    read('src/v21/web/app.v21.js'),
    read('src/v21/web/app.v21.css'),
  ]);
  const resultPanelStart = page.indexOf('<section class="panel result-panel"');
  const historyStart = page.indexOf('<div class="history-panel-shell"');
  const resourceStripStart = page.indexOf('<div class="resource-strip"');
  assert.ok(resultPanelStart >= 0 && historyStart > resultPanelStart);
  assert.ok(resourceStripStart > historyStart);
  assert.match(page, /<details class="history-panel"[^>]*>/u);
  assert.doesNotMatch(page, /<details class="history-panel"[^>]*\sopen(?:\s|>)/u);
  assert.match(page, /<summary[^>]*>[\s\S]*生成记录 History/u);
  assert.match(page, /<div class="history-top-actions">[\s\S]*id="history-summary-count"[\s\S]*id="history-toggle"[\s\S]*启用记录/u);
  const historyBody = page.match(/<div class="history-body">([\s\S]*?)<\/details>/u)?.[1] ?? '';
  assert.doesNotMatch(historyBody, /id="history-toggle"/u);
  assert.doesNotMatch(app, /className = 'history-type'/u);
  assert.match(app, /historyIconButton\(`复制第 \$\{index \+ 1\} 条生成记录`/u);
  assert.match(app, /historyIconButton\(`删除第 \$\{index \+ 1\} 条生成记录`/u);
  assert.match(css, /\.history-preview\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/su);
  assert.match(css, /\.history-icon-button\s*\{/u);
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
    'data-preset-custom="\\$\\{kind\\}"',
    'data-complexity-level',
    'data-password-length-preset',
    'data-password-quantity-preset',
    'name="length" type="number"',
    'name="quantity" type="number"',
  ]) assert.match(app, new RegExp(required));
  assert.match(app, /kind: 'complexity',[^\n]*maximumIndex: PASSWORD_COMPLEXITY_PRESETS\.length - 1/u);
  assert.doesNotMatch(app, /data-preset-custom="complexity"/u);
  assert.match(css, /\.preset-slider-control/u);
  assert.match(css, /\.preset-slider-range/u);
  assert.match(css, /\.preset-slider-mark/u);
  assert.match(css, /\.preset-exact-input/u);
  assert.match(css, /\.preset-slider-control\s*\{[^}]*grid-template-columns:\s*108px\s+minmax\(0,\s*1fr\)/su);
  assert.match(css, /\.preset-slider-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/su);
  assert.match(css, /\.preset-slider-track\s*\{[^}]*--slider-thumb-size:\s*18px;[^}]*--slider-thumb-radius:\s*9px;/su);
  assert.match(css, /\.preset-slider-range\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*2;[^}]*background-size:\s*calc\(100%\s*-\s*var\(--slider-thumb-size\)\)\s+7px;/su);
  assert.match(css, /\.preset-slider-mark-row\s*\{[^}]*z-index:\s*1;[^}]*margin:\s*3px\s+var\(--slider-thumb-radius\)\s+0;/su);
  assert.match(css, /\.preset-slider-mark\.is-active::before\s*\{[^}]*width:\s*1px;[^}]*background:\s*#aebfb8;/su);
  assert.doesNotMatch(css, /\.preset-slider-mark\.is-active::before\s*\{[^}]*background:\s*var\(--blue\)/su);
  assert.match(css, /\.workspace\s*\{[^}]*grid-template-columns:\s*220px\s+minmax\(720px,\s*820px\)\s+minmax\(390px,\s*1fr\)/su);
  assert.match(css, /\.preset-exact-value\s*\{[^}]*grid-template-columns:\s*126px\s+auto/su);
  assert.match(app, /class="preset-slider-label field-label"/u);
  assert.match(app, /class="preset-exact-input"[^>]*aria-label="精确密码长度"/u);
  assert.match(app, /class="preset-exact-input"[^>]*aria-label="精确生成数量"/u);
  assert.doesNotMatch(app, /<span>精确值<\/span>/u);
  assert.match(app, /data-exact-unit="length">位/u);
  assert.match(app, /data-exact-unit="quantity">个/u);
  assert.match(app, /checkbox\('allowSpace', '空格'\)/u);
  assert.doesNotMatch(app, /内部空格/u);
  assert.match(app, /name="startsWith">[\s\S]*?<option value="letter" selected>字母<\/option>/u);
  assert.match(app, /name="endsWith">[\s\S]*?<option value="letter" selected>字母<\/option>/u);
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

test('批量结果只渲染一份公共安全说明并提供单条重新生成', async () => {
  const [app, css, page] = await Promise.all([
    read('src/v21/web/app.v21.js'),
    read('src/v21/web/app.v21.css'),
    read('src/v21/web/page.v21.html'),
  ]);
  assert.match(app, /buildCompactResultRow/u);
  assert.match(app, /buildBatchAssessment/u);
  assert.match(app, /regenerateResult/u);
  assert.match(app, /createBatchRequestSnapshot/u);
  assert.doesNotMatch(app, /buildResultCard/u);
  assert.match(css, /\.compact-result-list/u);
  assert.match(css, /\.compact-result-row/u);
  assert.match(css, /\.batch-assessment/u);
  assert.match(css, /\.result-icon-button/u);
  assert.match(app, /result-action-tooltip-\$\{name\}-\$\{result\.id\}/u);
  assert.match(app, /内容已隐藏；请先使用显示按钮/u);
  assert.match(page, /id="regenerate-all"/u);
  assert.match(page, />重新生成全部</u);
});

test('V2.1 正式入口、V1.7.5 归档与 Pages 门禁使用单一发布版本', async () => {
  const [workflow, sitemap, llms, readme, english] = await Promise.all([
    read('.github/workflows/v201-pages.yml'),
    read('sitemap.xml'),
    read('llms.txt'),
    read('README.md'),
    read('docs/readme-en.md'),
  ]);
  assert.match(workflow, /name:\s*V2\.1 security gate/u);
  assert.match(workflow, /npm run verify:v21/u);
  assert.match(workflow, /git diff --exit-code -- index\.html index-2\.1\.html assets\/v2\.1/u);
  assert.match(workflow, /cp index\.html index-v1\.75\.html index-2\.1\.html _site\//u);
  assert.doesNotMatch(workflow, /cp [^\n]*(?:index-2\.0\.html|v2\.01\.html)/u);
  assert.doesNotMatch(workflow, /cp -R assets(?:\s|$)/u);
  assert.match(workflow, /assets\/data assets\/js assets\/modules assets\/vendor assets\/wordpacks assets\/v2\.1/u);
  assert.match(workflow, /Reject retired pages and analytics/u);
  assert.match(sitemap, /https:\/\/betaer\.github\.io\/password-generator\/index\.html/u);
  assert.match(llms, /V2\.1 正式版：https:\/\/betaer\.github\.io\/password-generator\/index\.html/u);
  assert.match(readme, /^# Security Random Generator V2\.1/mu);
  assert.match(readme, /在线使用 V2\.1[^\n]*index\.html/u);
  assert.match(readme, /npm run verify:v21/u);
  assert.match(english, /^# Security Random Generator V2\.1/mu);
  assert.match(english, /Use V2\.1[^\n]*index\.html/u);
  assert.match(english, /npm run verify:v21/u);
});
