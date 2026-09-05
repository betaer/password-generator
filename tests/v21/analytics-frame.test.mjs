import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('无 Cookie 兼容层在 Google 脚本前执行，不读取原生 Cookie 或放开沙箱', async () => {
  const html = await readFile(new URL('../../src/v21/web/analytics-frame.v21.html', import.meta.url), 'utf8');
  const match = html.match(/<script id="v21-analytics-config">([\s\S]*?)<\/script>/u);
  const document = Object.create({ get cookie() { throw new Error('opaque-origin cookie'); } });
  const context = vm.createContext({ document });
  vm.runInContext(match[1], context);
  assert.equal(document.cookie, '');
  document.cookie = 'SENTINEL_COOKIE=value';
  assert.equal(document.cookie, '');
  assert.equal(Object.getOwnPropertyDescriptor(document, 'cookie').configurable, false);
  assert.ok(html.indexOf('</script>', match.index) < html.indexOf('<script async src="https://www.googletagmanager.com'));
  assert.doesNotMatch(match[1], /(?:parent|top)\.|postMessage\s*\(/u);
  const consent = Array.from(context.dataLayer).find(row => row[0] === 'consent')[2];
  assert.ok(Object.values(consent).every(value => value === 'denied'));
});
