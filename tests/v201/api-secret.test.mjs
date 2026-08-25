import test from 'node:test';
import assert from 'node:assert/strict';

import { generateApiSecret } from '../../src/v201/api-secret.mjs';

function fixedCrypto(viewValue = 0xab) {
  return {
    getRandomValues(view) {
      view.fill(viewValue);
      return view;
    },
  };
}

test('Generic API Secret 显式组合 prefix/environment/version', () => {
  const result = generateApiSecret({
    template: 'generic',
    byteLength: 2,
    encoding: 'hex',
    prefix: 'service_',
    environment: 'stage',
    version: 'v2',
  }, fixedCrypto());

  assert.equal(result.value, 'service_stage_v2_abab');
  assert.equal(result.configSnapshot.syntheticAppearance, false);
  assert.equal(result.generationModel.nominalCsprngOutputBits, 16);
});

test('Synthetic Demo 使用固定无厂商含义前缀并忽略环境字段', () => {
  const result = generateApiSecret({
    template: 'synthetic-demo',
    byteLength: 2,
    encoding: 'hex',
    prefix: 'sk_live_',
    environment: 'live',
    version: 'prod',
  }, fixedCrypto(0xcd));

  assert.equal(result.value, 'demo_test_v1_cdcd');
  assert.equal(result.configSnapshot.prefix, 'demo_test_v1_');
  assert.equal(result.configSnapshot.environment, '');
  assert.equal(result.configSnapshot.version, '');
  assert.equal(result.configSnapshot.syntheticAppearance, true);
  assert.match(result.configSnapshot.warning, /合成|示例/u);
});

test('API Secret 拒绝未知模板和超长自由文本字段', () => {
  assert.throws(() => generateApiSecret({ template: 'stripe-like' }, fixedCrypto()), RangeError);
  assert.throws(() => generateApiSecret({ prefix: 'x'.repeat(65) }, fixedCrypto()), RangeError);
  assert.throws(() => generateApiSecret({ environment: 'x'.repeat(33) }, fixedCrypto()), RangeError);
  assert.throws(() => generateApiSecret({ version: 'x'.repeat(33) }, fixedCrypto()), RangeError);
});

