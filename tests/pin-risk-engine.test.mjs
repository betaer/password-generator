import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  inspectPin,
  parsePinRiskDatabasePayload,
  shouldBlockWeakPin,
} from '../assets/modules/pin-risk-engine.js';

const payload = JSON.parse(await readFile(new URL('../assets/data/pin-risk.v1.json', import.meta.url), 'utf8'));
const database = parsePinRiskDatabasePayload(payload);

test('PIN 风险库包含完整 4 位空间与 68,202 个 6 位常见值', () => {
  assert.equal(database.metadata.fourDigitCount, 10000);
  assert.equal(database.metadata.sixDigitCount, 68202);
  assert.equal(database.fourDigitRanks.length, 10000);
  assert.equal(database.sixDigitRanks.size, 68202);
});

test('常见 PIN 返回频率排名并触发拦截', () => {
  for (const pin of ['1234', '0000', '1111', '1212', '123456', '654321']) {
    const risk = inspectPin(pin, database);
    assert.equal(risk.known, true, `${pin} 应存在于风险库`);
    assert.ok(risk.rank > 0, `${pin} 应有频率排名`);
    assert.equal(shouldBlockWeakPin(pin, database), true, `${pin} 应被判定为明显弱 PIN`);
  }
});

test('规则引擎可识别重复、连续、循环、日期和键盘路径', () => {
  assert.ok(inspectPin('777777', database).patterns.includes('全部重复'));
  assert.ok(inspectPin('234567', database).patterns.includes('连续数字'));
  assert.ok(inspectPin('121212', database).patterns.includes('短周期循环'));
  assert.ok(inspectPin('082519', database).patterns.includes('日期样式'));
  assert.ok(inspectPin('2580', database).patterns.includes('键盘路径'));
});

test('不在高频阈值且无明显规则的 PIN 不会被误拦截', () => {
  const risk = inspectPin('583907', database);
  assert.equal(risk.patterns.length, 0);
  assert.equal(shouldBlockWeakPin('583907', database), false);
});

test('异常输入安全降级', () => {
  assert.equal(inspectPin('12a4', database).valid, false);
  assert.equal(inspectPin('12345', database).valid, false);
  assert.equal(shouldBlockWeakPin(null, database), false);
});
