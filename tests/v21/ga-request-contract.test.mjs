import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGaRequestContract } from '../../scripts/ga-request-contract.mjs';

const fixedUrl = 'https://betaer.github.io/password-generator/index.html';
const query = new URLSearchParams({ dl: fixedUrl, dt: 'Password Generator V2.1', en: 'page_view' });
const request = () => ({ url: `https://www.google-analytics.com/g/collect?${query}`, body: '', headers: {} });
test('真实 GA 契约解析查询和多行 POST，空或省略 referrer 均合法', () => {
  assertGaRequestContract(request(), ['UNIQUE_TEST_SENTINEL']);
  assertGaRequestContract({ url: 'https://region1.google-analytics.com/g/collect', body: `${query}&dr=\n${query}&dp=%2Fpassword-generator%2Findex.html`, headers: {} }, []);
});
test('拒绝编码后的秘密、重复的恶意页面字段及 Cookie header', () => {
  for (const record of [
    { ...request(), body: 'ep.prefix=UNIQUE_TEST_SENTINEL' },
    { ...request(), body: 'ep.prefix=%2555NIQUE_TEST_SENTINEL' },
    { ...request(), body: 'dl=https%3A%2F%2Fevil.invalid' },
    { ...request(), body: 'dr=https%3A%2F%2Fprivate.invalid' },
    { ...request(), headers: { Cookie: 'abc=1' } },
    { ...request(), body: 'dt=private-title' },
    { ...request(), url: 'https://evil.invalid/g/collect' },
    { ...request(), url: 'https://www.google-analytics.com/g/collect' },
  ]) assert.throws(() => assertGaRequestContract(record, ['UNIQUE_TEST_SENTINEL']));
});
