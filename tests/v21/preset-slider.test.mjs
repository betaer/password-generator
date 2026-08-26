import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discreteSliderIndex,
  discreteSliderValue,
} from '../../src/v21/preset-slider.mjs';

test('离散滑块把快捷值映射为刻度，把非快捷值映射为自定义刻度', () => {
  assert.equal(discreteSliderIndex(20, [4, 8, 12, 20, 32]), 3);
  assert.equal(discreteSliderIndex(37, [4, 8, 12, 20, 32]), 5);
  assert.equal(discreteSliderIndex('L8', ['L1', 'L2', 'L8']), 2);
  assert.equal(discreteSliderIndex('custom', ['L1', 'L2', 'L8']), 3);
});

test('离散滑块只在快捷刻度改值，自定义刻度保留当前精确值', () => {
  const presets = [4, 8, 12, 20, 32];
  assert.equal(discreteSliderValue(2, presets, 37), 12);
  assert.equal(discreteSliderValue(presets.length, presets, 37), 37);
});

test('离散滑块拒绝空档位、重复档位和越界索引', () => {
  assert.throws(() => discreteSliderIndex(1, []), /non-empty/u);
  assert.throws(() => discreteSliderIndex(1, [1, 1]), /unique/u);
  assert.throws(() => discreteSliderValue(-1, [1, 2], 3), /slider index/u);
  assert.throws(() => discreteSliderValue(0.5, [1, 2], 3), /slider index/u);
  assert.throws(() => discreteSliderValue(4, [1, 2], 3), /slider index/u);
});
