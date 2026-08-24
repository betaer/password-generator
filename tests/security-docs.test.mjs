import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [readmeZh, readmeEn, llms, notices] = await Promise.all([
  readProjectFile('README.md'),
  readProjectFile('docs/readme-en.md'),
  readProjectFile('llms.txt'),
  readProjectFile('THIRD_PARTY_NOTICES.md'),
]);

test('中英文 README 保留统一的访问量统计徽章', () => {
  const badge = 'visitor-badge.laobi.icu/badge?page_id=betaer.password-generator';
  assert.ok(readmeZh.includes(badge));
  assert.ok(readmeEn.includes(badge));
});

test('中英文 README 说明完整安全分析链路', () => {
  for (const content of [readmeZh, readmeEn]) {
    assert.match(content, /rejection sampling|拒绝采样/i);
    assert.match(content, /zxcvbn/i);
    assert.match(content, /68,202/);
    assert.match(content, /在线限速|online rate-limited/i);
    assert.match(content, /慢速密码哈希|slow password hash/i);
    assert.match(content, /快速离线|fast offline/i);
    assert.match(content, /安全保证|security guarantee/i);
    assert.match(content, /DevTools/i);
    assert.match(content, /generated_value/);
  }
});

test('README 明确展示词包熵差异与主题词包建议', () => {
  assert.match(readmeZh, /1,024[\s\S]*?10 bits[\s\S]*?40 bits[\s\S]*?60 bits/);
  assert.match(readmeZh, /1,296[\s\S]*?10\.34 bits[\s\S]*?41\.36 bits[\s\S]*?62\.04 bits/);
  assert.match(readmeZh, /7,776[\s\S]*?12\.92 bits[\s\S]*?51\.70 bits[\s\S]*?77\.55 bits/);
  assert.match(readmeZh, /主题词包[^\n]*至少 6 个词/);
});

test('第三方声明覆盖安全分析和词库来源', () => {
  assert.match(notices, /@zxcvbn-ts\/core/);
  assert.match(notices, /SecLists/);
  assert.match(notices, /EFF Diceware/);
  assert.match(notices, /Datamuse/);
});

test('llms 摘要同步关键安全事实', () => {
  assert.match(llms, /拒绝采样/);
  assert.match(llms, /zxcvbn/i);
  assert.match(llms, /68,202/);
  assert.match(llms, /三种攻击模型/);
});
