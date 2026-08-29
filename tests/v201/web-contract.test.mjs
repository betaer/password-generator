import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

async function read(relative) {
  return readFile(new URL(relative, root), 'utf8');
}

test('V2.0.1 历史源码保留统一概率契约和按类型安全语义', async () => {
  const html = await read('src/v201/web/page.v201.html');
  assert.match(html, /V2\.0\.1/);
  assert.match(html, /一套概率契约 · 九类安全生成器/);
  assert.match(html, /精确计算生成空间；基于明确假设估算攻击成本/);
  assert.match(html, /隔离页面访问统计/);
  assert.doesNotMatch(html, /匿名页面访问统计|Exact Crack Time|精确 Crack Time/);
  assert.doesNotMatch(html, /assets\/v2\/|EmbeddedWordPacksV1|unsafe-inline/);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-same-origin|postMessage/);
});

test('V2.0.1 历史内容哈希资产仍可审计但不作为发布入口', async () => {
  const manifestText = await read('assets/v2.01/manifest.json');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.version, '2.0.1');
  for (const key of ['runtime', 'app', 'css', 'analyticsFrame', 'passwordWorker', 'zxcvbnWorker', 'passphrase', 'pinRisk']) {
    assert.match(manifest.assets[key], /\.[a-f0-9]{12}\.(?:js|css|html)$/u);
    assert.ok((await read(`assets/v2.01/${manifest.assets[key]}`)).length > 0, `${key} 历史资产必须可审计`);
  }
  assert.equal(manifest.assets.bip39.english.includes('.english.'), true);
});

test('页面源代码包含竞态、预算、剪贴板与按类型结果卡保护', async () => {
  const source = await read('src/v201/web/app.v201.js');
  assert.match(source, /createGenerationCoordinator/);
  assert.match(source, /generateAtomicBatch/);
  assert.match(source, /assertBatchBudget/);
  assert.match(source, /assertClipboardBudget/);
  assert.match(source, /data-v201-clipboard-fallback/);
  assert.match(source, /presentationProfile/);
  assert.match(source, /这是标识符，不是秘密/);
  assert.match(source, /观察模式估算/);
  assert.match(source, /攻击场景估算/);
  assert.doesNotMatch(source, /textarea\.style\.|EmbeddedWordPacksV1|PasswordGeneratorV2\b/);
});

test('V2.0.1 工作区、九类结果与快捷操作采用完整中文交互', async () => {
  const [html, source, css] = await Promise.all([
    read('src/v201/web/page.v201.html'),
    read('src/v201/web/app.v201.js'),
    read('src/v201/web/app.v201.css'),
  ]);
  assert.match(html, /1、<\/span>选择生成类型/);
  assert.match(html, /2、策略配置/);
  assert.match(html, /3、生成结果/);
  assert.match(html, /生成记录 History/);
  assert.match(html, /site-floating-actions/);
  for (const label of ['密码', '口令', 'PIN 码', '助记词', '令牌', 'API 密钥', '十六进制', '随机字节', 'UUID 标识符']) {
    assert.match(source, new RegExp(label));
  }
  for (const label of ['精确生成器指标', '观察模式估算', '攻击场景估算', '生成模型详情']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /updateSecretPresentation/);
  assert.match(source, /updateResultAssessment/);
  assert.doesNotMatch(source, /function scheduleRender/);
  assert.match(source, /copySharePromotion/);
  assert.match(source, /SHARE_PROMOTION_TEXT/);
  assert.match(source, /通用模板/);
  assert.match(source, /合成演示模板/);
  assert.match(source, /均匀约束密码模型 V2\.0\.1/);
  assert.doesNotMatch(source, /方案标识:\s*result\.schemeId/);
  assert.match(source, /128 比特 · 12 个词/);
  assert.doesNotMatch(source, /Secret 随机字节|>Generic<|Synthetic Demo 是|bits · \d+ words|非 English 词表|printable ASCII|无 padding|quantity=1/);
  assert.match(css, /\.history-row/);
  assert.match(css, /\.intro h1 span\s*\{[^}]*display:\s*block/su);
  assert.doesNotMatch(css, /\.result-card\s*\{[^}]*animation:/su);
});
