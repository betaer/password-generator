import test from 'node:test';
import assert from 'node:assert/strict';

import { createPasswordModel } from '../../src/v2/password-model.mjs';
import {
  PASSWORD_COMPLEXITY_PRESETS,
  PASSWORD_LENGTH_PRESETS,
  PASSWORD_QUANTITY_PRESETS,
  applyPasswordComplexityPreset,
} from '../../src/v21/password-controls.mjs';

const BASE_CONFIG = Object.freeze({
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  symbolPool: '!@#$%^&*()-_=+[]{};:,.?',
  allowSpace: false,
  requireEach: true,
  allowRepeated: true,
  symbolRatioRange: [10, 35],
  startsWith: 'any',
  endsWith: 'any',
});

test('复杂度控件完整恢复 L1 到 L8 且配方逐级增加精确生成器最小熵', () => {
  assert.deepEqual(PASSWORD_COMPLEXITY_PRESETS.map(({ level }) => level), [
    'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8',
  ]);
  const bits = PASSWORD_COMPLEXITY_PRESETS.map(({ level }) => {
    const config = applyPasswordComplexityPreset(BASE_CONFIG, level);
    assert.equal(Object.isFrozen(config), true);
    assert.equal(Object.isFrozen(config.symbolRatioRange), true);
    return createPasswordModel(config).minEntropyBits;
  });
  for (let index = 1; index < bits.length; index += 1) {
    assert.ok(bits[index] > bits[index - 1], `${PASSWORD_COMPLEXITY_PRESETS[index].level} 应强于上一档`);
  }
});

test('长度与数量快捷档位保留精确自定义输入边界', () => {
  assert.deepEqual(PASSWORD_LENGTH_PRESETS, [4, 6, 8, 12, 16, 20, 24, 32, 64, 128, 256]);
  assert.deepEqual(PASSWORD_QUANTITY_PRESETS, [1, 3, 5, 10, 25, 50, 100]);
  assert.equal(Math.min(...PASSWORD_LENGTH_PRESETS), 4);
  assert.equal(Math.max(...PASSWORD_LENGTH_PRESETS) < 4096, true);
  assert.equal(Math.max(...PASSWORD_QUANTITY_PRESETS), 100);
});

test('复杂度配方拒绝未知等级且不会改写调用方配置', () => {
  const mutable = { ...BASE_CONFIG, symbolRatioRange: [...BASE_CONFIG.symbolRatioRange] };
  const before = structuredClone(mutable);
  assert.throws(() => applyPasswordComplexityPreset(mutable, 'L9'), /complexity level/u);
  applyPasswordComplexityPreset(mutable, 'L8');
  assert.deepEqual(mutable, before);
});
