import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index-v1.75.html', root), 'utf8');
const robots = await readFile(new URL('robots.txt', root), 'utf8');
const sitemap = await readFile(new URL('sitemap.xml', root), 'utf8');
const llms = await readFile(new URL('llms.txt', root), 'utf8');
const socialPreview = await readFile(new URL('assets/social-preview.png', root));

test('页面提供一致的 SEO、Open Graph 与 Twitter Card 标题', () => {
  const title = '密码生成器 Password Generator｜随机密码、记忆短语与 PIN';
  assert.match(html, new RegExp(`<title>${title.replace('|', '\\|')}</title>`));
  assert.match(html, new RegExp(`<meta property="og:title" content="${title.replace('|', '\\|')}"`));
  assert.match(html, new RegExp(`<meta name="twitter:title" content="${title.replace('|', '\\|')}"`));
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/betaer\.github\.io\/password-generator\/index-v1\.75\.html"/);
  assert.doesNotMatch(html, /hreflang="en"/u);
  assert.doesNotMatch(html, /og:locale:alternate/u);
  assert.match(html, /<meta name="googlebot" content="index, follow, max-image-preview:large/);
  assert.doesNotMatch(html, /noindex|nofollow|noimageindex/i);
  assert.match(html, /allow_google_signals: false/);
  assert.match(html, /allow_ad_personalization_signals: false/);
});

test('社交缩略图使用绝对 HTTPS 地址且尺寸为 1200×630', () => {
  const imageUrl = 'https://betaer.github.io/password-generator/assets/social-preview.png';
  assert.match(html, new RegExp(`<meta property="og:image" content="${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(html, new RegExp(`<meta name="twitter:image" content="${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.equal(socialPreview.subarray(1, 4).toString(), 'PNG');
  assert.equal(socialPreview.readUInt32BE(16), 1200);
  assert.equal(socialPreview.readUInt32BE(20), 630);
});

test('WebSite、SoftwareApplication 与 BreadcrumbList JSON-LD 可解析', () => {
  const payload = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(payload, '缺少 JSON-LD');
  const data = JSON.parse(payload);
  assert.ok(Array.isArray(data['@graph']), 'JSON-LD 应使用 @graph');
  const website = data['@graph'].find((entry) => entry['@type'] === 'WebSite');
  const application = data['@graph'].find((entry) => entry['@type'] === 'SoftwareApplication');
  const breadcrumb = data['@graph'].find((entry) => entry['@type'] === 'BreadcrumbList');
  assert.equal(website.url, 'https://betaer.github.io/');
  assert.equal(application.name, '密码生成器 Password Generator');
  assert.ok(application.alternateName.includes('Password Generator'));
  assert.equal(application.applicationCategory, 'SecurityApplication');
  assert.equal(application.inLanguage, 'zh-CN');
  assert.equal(application.url, 'https://betaer.github.io/password-generator/index-v1.75.html');
  assert.equal(application.isAccessibleForFree, true);
  assert.equal(breadcrumb.itemListElement.length, 2);
  assert.equal(breadcrumb.itemListElement[0].item, 'https://betaer.github.io/');
  assert.equal(data['@graph'].some((entry) => entry['@type'] === 'FAQPage'), false);
});

test('V1.7.5 归档页可见标明版本并提供正式版入口', () => {
  assert.match(html, /<aside class="archive-release-banner"[^>]*>[\s\S]*V1\.7\.5 归档版[\s\S]*href="\.\/index\.html"[\s\S]*进入 V2\.1 正式版/u);
});

test('静态 SEO Shell 整体默认折叠并在全站底部提供相关工具互链', () => {
  const rootEnd = html.indexOf('<div id="root"></div>');
  const shellStart = html.indexOf('<main id="seo-content" class="seo-shell"');
  const shellEnd = html.indexOf('</main>', shellStart);
  const footerStart = html.indexOf('<footer class="site-global-footer"', shellEnd);
  assert.ok(rootEnd > -1 && shellStart > rootEnd, 'SEO Shell 应位于应用根节点之外');
  assert.ok(footerStart > shellEnd, '项目互链应位于 SEO Shell 之外的全站底部');
  assert.match(html, /<details id="security-verification" class="seo-shell-overview">/);
  assert.doesNotMatch(html, /<details id="security-verification" class="seo-shell-overview" open>/);
  assert.match(html, /<summary class="seo-shell-overview-summary">/);
  assert.match(html, /<h1 id="seo-security-title">安全与可验证性<\/h1>/);
  assert.doesNotMatch(html, /本地安全工具 · Local Security Tool|id="seo-features-title"|class="seo-shell-card"/);
  assert.doesNotMatch(html, /id="seo-faq-title"|class="seo-shell-faq"/);
  assert.match(html, /访问统计不包含密码、PIN、记忆短语或输入内容/);
  assert.match(html, /Web Crypto API/);
  assert.match(html, /href="https:\/\/betaer\.github\.io\/AiSignalGuard\/" title="AI Signal Guard"/);
});

test('V1.7.5 归档页引用 Host 根级 robots、Sitemap 与归档发现地址', () => {
  const canonical = 'https://betaer.github.io/password-generator/index-v1.75.html';
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Sitemap: https:\/\/betaer\.github\.io\/sitemap\.xml/);
  assert.match(html, /<link rel="sitemap" type="application\/xml" href="https:\/\/betaer\.github\.io\/sitemap\.xml"/);
  assert.ok(sitemap.includes(`<loc>${canonical}</loc>`));
  assert.ok(llms.includes(`V1.7.5 归档版：${canonical}`));
  assert.match(llms, /浏览器 Web Crypto API/);
});
