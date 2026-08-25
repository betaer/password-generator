import test from 'node:test';
import assert from 'node:assert/strict';

import { createPowerOfTwoSearchSpace } from '../../src/v201/probability-contract.mjs';
import {
  ASSESSMENT_PROFILES,
  createSecurityAssessment,
} from '../../src/v201/security-assessment.mjs';

function model(profile, bits = 128) {
  return {
    searchSpace: createPowerOfTwoSearchSpace(bits),
    generatorMinEntropyBits: bits,
    generatorShannonEntropyBits: bits,
    nominalCsprngOutputBits: bits,
    presentationProfile: profile,
  };
}

test('Password 将精确生成器、观察模式和攻击场景分成三层', () => {
  const assessment = createSecurityAssessment({
    generationModel: model('password'),
    patternAnalysis: { status: 'ready', guessBits: 32, sequences: ['dictionary'] },
  });

  assert.equal(assessment.profile, ASSESSMENT_PROFILES.password);
  assert.equal(assessment.exactGenerator.expectedRank.bits > 126, true);
  assert.deepEqual(assessment.observedPattern.sequences, ['dictionary']);
  assert.equal(assessment.observedPattern.guessBits, 32);
  assert.equal(assessment.attackScenarios.length, 3);
  assert.equal('effectiveGuessBits' in assessment, false);
  assert.match(assessment.disclaimer, /估算/u);
});

test('UUID 是 identifier，不渲染密码等级、模式分析或破解时间', () => {
  const assessment = createSecurityAssessment({ generationModel: model('uuid', 122) });

  assert.equal(assessment.profile, ASSESSMENT_PROFILES.uuid);
  assert.equal(assessment.identifierNotice, '这是标识符，不是秘密');
  assert.equal(assessment.observedPattern, null);
  assert.deepEqual(assessment.attackScenarios, []);
  assert.equal('strength' in assessment, false);
});

test('Random Bytes 与 BIP39 使用各自语义，不复用密码破解时间', () => {
  for (const profile of ['random-bytes', 'bip39']) {
    const assessment = createSecurityAssessment({ generationModel: model(profile, 256) });
    assert.equal(assessment.profile, ASSESSMENT_PROFILES[profile]);
    assert.deepEqual(assessment.attackScenarios, []);
    assert.equal(assessment.observedPattern, null);
    assert.equal('strength' in assessment, false);
  }
});

test('Token/API Secret/Hex 只展示名义随机位数与碰撞语义', () => {
  for (const profile of ['token', 'api-secret', 'hex']) {
    const assessment = createSecurityAssessment({ generationModel: model(profile, 128) });
    assert.equal(assessment.machineSecret.nominalCsprngOutputBits, 128);
    assert.equal(assessment.observedPattern, null);
    assert.deepEqual(assessment.attackScenarios, []);
  }
});
