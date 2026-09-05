import assert from 'node:assert/strict';

export function assertGaRequestContract(request, secrets) {
  const url = new URL(request.url);
  assert.ok(['www.google-analytics.com', 'region1.google-analytics.com'].includes(url.hostname), '非预期统计端点');
  const entries = [...url.searchParams];
  for (const line of request.body.split(/\r?\n/u)) entries.push(...new URLSearchParams(line));
  let decoded = `${request.url}\n${request.body}\n${JSON.stringify(request.headers)}`;
  for (let index = 0; index < 3; index++) {
    for (const secret of secrets) assert.ok(!decoded.includes(secret), '统计请求包含测试秘密，拒绝发布');
    try { decoded = decodeURIComponent(decoded); } catch { break; }
  }
  assert.ok(!Object.keys(request.headers).some(name => name.toLowerCase() === 'cookie'), '统计请求不得携带 Cookie');
  const all = key => entries.filter(([name]) => name === key).map(([, value]) => value);
  assert.ok(all('dl').length > 0, '统计请求缺少固定页面 URL');
  for (const value of all('dl')) assert.equal(value, 'https://betaer.github.io/password-generator/index.html');
  for (const value of all('dr')) assert.equal(value, '');
  for (const value of all('dt')) assert.equal(value, 'Password Generator V2.1');
  for (const key of ['dp', 'ep.page_path']) for (const value of all(key)) assert.equal(value, '/password-generator/index.html');
  return { pageView: all('en').includes('page_view') };
}
