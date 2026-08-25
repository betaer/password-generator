import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const frame = await readFile(
  new URL('../../assets/v2/analytics-frame.html', import.meta.url),
  'utf8',
);
const parent = await readFile(new URL('../../index-2.0.html', import.meta.url), 'utf8');

function contentSecurityPolicy(source) {
  const tag = source.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  assert.ok(tag, '页面必须声明 Content-Security-Policy meta');
  const content = tag[0].match(/\bcontent=(?:"([^"]*)"|'([^']*)')/i);
  assert.ok(content, 'Content-Security-Policy meta 必须包含 content');
  return content[1] ?? content[2];
}

function iframeTag(source) {
  const matches = [...source.matchAll(/<iframe\b[^>]*>/gi)].map((match) => match[0]);
  assert.equal(matches.length, 1, 'V2 主页面必须且只能包含一个统计 iframe');
  return matches[0];
}

test('frame: 只配置固定公开 V2 page_location 与 GA Measurement ID', () => {
  assert.match(frame, /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-DWZ72TFWQF/);
  assert.match(frame, /gtag\('config',\s*'G-DWZ72TFWQF'/);
  assert.match(frame, /page_location:\s*'https:\/\/betaer\.github\.io\/password-generator\/index-2\.0\.html'/);
  assert.match(frame, /page_path:\s*'\/password-generator\/index-2\.0\.html'/);
  assert.match(frame, /page_referrer:\s*''/);
  assert.doesNotMatch(frame, /location\.(?:href|search|hash|pathname)|new\s+URL\s*\(/);
});

test('frame: CSP 只开放 GA 脚本和统计上报所需来源并校验内联脚本哈希', () => {
  const csp = contentSecurityPolicy(frame);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+' https:\/\/www\.googletagmanager\.com/);
  assert.match(csp, /connect-src https:\/\/www\.google-analytics\.com https:\/\/region1\.google-analytics\.com/);
  assert.match(csp, /img-src https:\/\/www\.google-analytics\.com/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'|\*|doubleclick|analytics\.google\.com/);

  const inline = frame.match(/<script\s+id=["']v2-analytics-config["']>([\s\S]*?)<\/script>/i);
  assert.ok(inline, '统计配置必须有唯一的哈希授权内联脚本');
  const expected = `sha256-${createHash('sha256').update(inline[1]).digest('base64')}`;
  assert.match(csp, new RegExp(`'${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
});

test('frame: 拒绝 Google signals、广告个性化与客户端存储', () => {
  assert.match(frame, /allow_google_signals:\s*false/);
  assert.match(frame, /allow_ad_personalization_signals:\s*false/);
  assert.match(frame, /client_storage:\s*'none'/);
  for (const consent of ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage', 'functionality_storage', 'personalization_storage']) {
    assert.match(frame, new RegExp(`${consent}:\\s*'denied'`));
  }
  assert.doesNotMatch(frame, /localStorage|sessionStorage|indexedDB|document\.cookie|cookie_/);
});

test('frame: 不读取父页面、来源、查询、hash，也不建立消息桥', () => {
  assert.doesNotMatch(frame, /\bparent\b|\btop\b|window\.opener|window\.name/);
  assert.doesNotMatch(frame, /document\.referrer|location\.(?:search|hash)|URLSearchParams/);
  assert.doesNotMatch(frame, /postMessage|onmessage|addEventListener\s*\(\s*['"]message['"]/);
  assert.doesNotMatch(frame, /generatedValue|currentResult|passphrase|mnemonic|apiSecret|randomBytes|secretValue/i);
});

test('parent: 不执行任何 Google 远程脚本且 CSP 不再信任 Google 域', () => {
  assert.doesNotMatch(parent, /<script\b[^>]*\bsrc=["']https:\/\/(?:www\.)?googletagmanager\.com/i);
  assert.doesNotMatch(parent, /\bgtag\s*\(|\bdataLayer\b/);
  const csp = contentSecurityPolicy(parent);
  assert.doesNotMatch(csp, /google|doubleclick/i);
  assert.match(csp, /frame-src 'self'/);
});

test('parent: 唯一统计 iframe 只有 allow-scripts 沙箱且不发送 referrer', () => {
  const tag = iframeTag(parent);
  assert.match(tag, /\bsrc=["']\.\/assets\/v2\/analytics-frame\.html["']/i);
  assert.match(tag, /\bsandbox=["']allow-scripts["']/i);
  assert.doesNotMatch(tag, /allow-same-origin|allow-forms|allow-popups|allow-top-navigation/i);
  assert.match(tag, /\breferrerpolicy=["']no-referrer["']/i);
  assert.match(tag, /\btitle=["'][^"']+["']/i);
});

test('parent: 与统计 frame 之间不存在任何 message bridge', () => {
  assert.doesNotMatch(parent, /\.contentWindow\s*\.\s*postMessage\s*\(/);
  assert.doesNotMatch(parent, /analytics-frame\.html[\s\S]{0,500}(?:postMessage|onmessage|['"]message['"])/i);
  assert.doesNotMatch(parent, /(?:postMessage|onmessage|['"]message['"])[\s\S]{0,500}analytics-frame\.html/i);
});
