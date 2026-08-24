import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const robots = await readFile(new URL('robots.txt', root), 'utf8');
const sitemap = await readFile(new URL('sitemap.xml', root), 'utf8');
const llms = await readFile(new URL('llms.txt', root), 'utf8');
const socialPreview = await readFile(new URL('assets/social-preview.png', root));

test('页面提供一致的 SEO、Open Graph 与 Twitter Card 标题', () => {
  const title = '密码生成器_助记词、PIN码 | Password Generator_Passphrase_PIN';
  assert.match(html, new RegExp(`<title>${title.replace('|', '\\|')}</title>`));
  assert.match(html, new RegExp(`<meta property="og:title" content="${title.replace('|', '\\|')}"`));
  assert.match(html, new RegExp(`<meta name="twitter:title" content="${title.replace('|', '\\|')}"`));
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/betaer\.github\.io\/password-generator\/"/);
  assert.match(html, /<meta name="googlebot" content="index, follow, max-image-preview:large/);
  assert.doesNotMatch(html, /noindex|nofollow|noimageindex/i);
});

test('社交缩略图使用绝对 HTTPS 地址且尺寸为 1200×630', () => {
  const imageUrl = 'https://betaer.github.io/password-generator/assets/social-preview.png';
  assert.match(html, new RegExp(`<meta property="og:image" content="${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(html, new RegExp(`<meta name="twitter:image" content="${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.equal(socialPreview.subarray(1, 4).toString(), 'PNG');
  assert.equal(socialPreview.readUInt32BE(16), 1200);
  assert.equal(socialPreview.readUInt32BE(20), 630);
});

test('WebSite、WebApplication 与 FAQPage JSON-LD 可解析并描述本地安全工具', () => {
  const payload = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(payload, '缺少 JSON-LD');
  const data = JSON.parse(payload);
  assert.ok(Array.isArray(data['@graph']), 'JSON-LD 应使用 @graph');
  const website = data['@graph'].find((entry) => entry['@type'] === 'WebSite');
  const application = data['@graph'].find((entry) => entry['@type'] === 'WebApplication');
  const faq = data['@graph'].find((entry) => entry['@type'] === 'FAQPage');
  assert.equal(website.name, '密码生成器_助记词、PIN码');
  assert.equal(application.name, '密码生成器');
  assert.ok(application.alternateName.includes('Password Generator'));
  assert.equal(application.applicationCategory, 'SecurityApplication');
  assert.equal(application.url, 'https://betaer.github.io/password-generator/');
  assert.equal(application.isAccessibleForFree, true);
  assert.equal(faq.mainEntity.length, 3);
});

test('静态 SEO Shell 在应用根节点之外提供功能说明、FAQ 与相关工具互链', () => {
  const rootEnd = html.indexOf('<div id="root"></div>');
  const shellStart = html.indexOf('<section class="seo-shell"');
  assert.ok(rootEnd > -1 && shellStart > rootEnd, 'SEO Shell 应位于应用根节点之外');
  assert.match(html, /<h1 id="seo-shell-title">密码生成器、助记词与 PIN 码工具<\/h1>/);
  assert.match(html, /Web Crypto API/);
  assert.match(html, /href="https:\/\/betaer\.github\.io\/AiSignalGuard\/" title="AI Signal Guard"/);
});

test('robots、sitemap 与 llms 信息使用同一规范地址', () => {
  const canonical = 'https://betaer.github.io/password-generator/';
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Sitemap: https:\/\/betaer\.github\.io\/password-generator\/sitemap\.xml/);
  assert.ok(sitemap.includes(`<loc>${canonical}</loc>`));
  assert.ok(llms.includes(`规范地址：${canonical}`));
  assert.match(llms, /浏览器 Web Crypto API/);
});
