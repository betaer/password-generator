import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const canonical = 'https://betaer.github.io/password-generator/index-2.1.html';

test('V2.1 SEO 元信息完整度与 V1.7.5 对齐且规范地址唯一', async () => {
  const [page, builtPage] = await Promise.all([
    read('src/v21/web/page.v21.html'),
    read('index-2.1.html'),
  ]);
  for (const pattern of [
    /<title>安全随机数据生成器 V2\.1｜密码、口令、PIN、Token、UUID 与 BIP39<\/title>/u,
    /<meta name="title"/u,
    /<meta name="application-name"/u,
    /<meta name="description"/u,
    /<meta name="keywords"/u,
    /<meta name="subject"/u,
    /<meta name="abstract"/u,
    /<meta name="author" content="betaer"/u,
    /<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"/u,
    /<meta name="googlebot"/u,
    /<meta name="bingbot"/u,
    new RegExp(`<link rel="canonical" href="${canonical.replaceAll('.', '\\.')}`),
    new RegExp(`<link rel="alternate" hreflang="zh-CN" href="${canonical.replaceAll('.', '\\.')}`),
    new RegExp(`<link rel="alternate" hreflang="x-default" href="${canonical.replaceAll('.', '\\.')}`),
    /<link rel="sitemap" type="application\/xml" href="https:\/\/betaer\.github\.io\/sitemap\.xml"/u,
    /<link rel="alternate" type="text\/plain" href="https:\/\/betaer\.github\.io\/password-generator\/llms\.txt"/u,
  ]) assert.match(page, pattern);
  assert.doesNotMatch(page, /hreflang="en"/u);
  assert.equal([...builtPage.matchAll(/<link rel="canonical"/gu)].length, 1, '发布页只能存在一个 canonical');
});

test('V2.1 提供完整 Open Graph、Twitter 和九类生成器 JSON-LD', async () => {
  const [page, socialPreview, socialSource] = await Promise.all([
    read('src/v21/web/page.v21.html'),
    readFile(new URL('../../assets/social-preview-v2.1.png', import.meta.url)),
    read('src/v21/web/social-preview.v21.html'),
  ]);
  for (const pattern of [
    /<meta property="og:type" content="website"/u,
    /<meta property="og:site_name"/u,
    /<meta property="og:locale" content="zh_CN"/u,
    /<meta property="og:title"/u,
    /<meta property="og:description"/u,
    new RegExp(`<meta property="og:url" content="${canonical.replaceAll('.', '\\.')}`),
    /<meta property="og:image" content="https:\/\/betaer\.github\.io\/password-generator\/assets\/social-preview-v2\.1\.png"/u,
    /<meta property="og:image:width" content="1200"/u,
    /<meta property="og:image:height" content="630"/u,
    /<meta name="twitter:card" content="summary_large_image"/u,
    /<meta name="twitter:title"/u,
    /<meta name="twitter:description"/u,
    /<meta name="twitter:image"/u,
    /<script id="v21-structured-data" type="application\/ld\+json">/u,
    /"@type": "SoftwareApplication"/u,
    /"softwareVersion": "2\.1\.0"/u,
    /"@type": "BreadcrumbList"/u,
  ]) assert.match(page, pattern);
  for (const generator of ['Password Generator', 'Passphrase Generator', 'PIN Generator', 'Token Generator', 'API Secret Generator', 'UUID Generator', 'Hex Generator', 'Random Bytes Generator', 'BIP39 Mnemonic Generator']) {
    assert.ok(page.includes(generator), `JSON-LD 缺少 ${generator}`);
  }
  const structuredText = page.match(/<script id="v21-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(structuredText, '缺少结构化数据');
  const structured = JSON.parse(structuredText);
  const application = structured['@graph'].find((entry) => entry['@type'] === 'SoftwareApplication');
  assert.equal(application.inLanguage, 'zh-CN');
  assert.equal(application.screenshot, undefined, '营销图不得伪装成产品截图');
  assert.equal(application.image, 'https://betaer.github.io/password-generator/assets/social-preview-v2.1.png');
  assert.equal(socialPreview.readUInt32BE(16), 1200);
  assert.equal(socialPreview.readUInt32BE(20), 630);
  for (const text of ['安全随机数据生成器', 'V2.1', 'Password', 'Passphrase', 'PIN', 'Token', 'API Secret', 'UUID', 'Hex', 'Random Bytes', 'BIP39 Mnemonic']) {
    assert.ok(socialSource.includes(text), `社交图源码缺少 ${text}`);
  }
});

test('V2.1 GEO 静态正文、llms.txt 与 Sitemap 使用一致事实和版本链接', async () => {
  const [page, llms, sitemap] = await Promise.all([
    read('src/v21/web/page.v21.html'),
    read('llms.txt'),
    read('sitemap.xml'),
  ]);
  assert.match(page, /<section id="v21-seo-content" class="seo-shell"/u);
  assert.match(page, /<details id="v21-security-verification" class="seo-shell-overview">/u);
  assert.doesNotMatch(page, /<details id="v21-security-verification" class="seo-shell-overview" open>/u);
  assert.match(page, /九类生成器与适用边界/u);
  assert.match(page, /精确生成器指标/u);
  assert.match(page, /观察模式估算/u);
  assert.match(page, /攻击场景估算/u);
  assert.match(page, /无 Cookie GA 页面访问统计/u);
  for (const name of ['Password', 'Passphrase', 'PIN', 'Token', 'API Secret', 'UUID', 'Hex', 'Random Bytes', 'BIP39 Mnemonic']) {
    assert.ok(llms.includes(name), `llms.txt 缺少 ${name}`);
  }
  assert.ok(sitemap.includes(`<loc>${canonical}</loc>`));
  assert.match(page, /href="\.\/index\.html">V1\.7\.5/u);
  assert.match(page, /href="\.\/index-2\.0\.html">V2\.0/u);
  assert.match(page, /href="\.\/v2\.01\.html">V2\.0\.1/u);
});

test('V2.1 构建为结构化数据内联脚本生成 CSP 哈希', async () => {
  const [page, build, builtPage] = await Promise.all([
    read('src/v21/web/page.v21.html'),
    read('scripts/build-v21.mjs'),
    read('index-2.1.html'),
  ]);
  assert.match(page, /__V21_SEO_HASH__/u);
  assert.match(build, /v21-structured-data/u);
  assert.match(build, /__V21_SEO_HASH__/u);
  const structuredText = builtPage.match(/<script id="v21-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(structuredText);
  JSON.parse(structuredText);
  const hash = createHash('sha256').update(structuredText).digest('base64');
  assert.ok(builtPage.includes(`script-src 'self' 'sha256-${hash}'`), '发布页 CSP 必须精确授权结构化数据脚本');
});
