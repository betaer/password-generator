import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createPinModel, createPinRiskIndex } from '../../src/v2/pin-model.mjs';
import { describePinPolicy } from '../../src/v201/pin-batch.mjs';

const payload = JSON.parse(await readFile(new URL('../../assets/data/pin-risk.v1.json', import.meta.url), 'utf8'));

test('PIN 风险过滤以启发式策略披露来源、阈值与过滤前后空间', () => {
  const riskIndex = createPinRiskIndex(payload);
  const model = createPinModel({ length: 4, blockWeak: true }, riskIndex);
  const policy = describePinPolicy(model, riskIndex);

  assert.equal(policy.name, 'Heuristic Common-PIN Exclusion Policy v1');
  assert.equal(policy.sourceCommit, payload.metadata.sourceCommit);
  assert.deepEqual(policy.rankThresholds, { fourDigit: 500, sixDigit: 1000 });
  assert.equal(policy.baseSearchSpace, model.baseSearchSpace);
  assert.equal(policy.allowedSearchSpace, model.searchSpace);
  assert.equal(policy.blockedCount, model.blockedCount);
  assert.match(policy.disclaimer, /common-first|等概率/u);
});

test('8 位及以上明确披露排名语料不覆盖，只应用规则过滤', () => {
  const riskIndex = createPinRiskIndex(payload);
  const model = createPinModel({ length: 8, blockWeak: true }, riskIndex);
  const policy = describePinPolicy(model, riskIndex);

  assert.equal(policy.rankedCorpusCoverage, '4-and-6-digits-only');
  assert.equal(policy.currentLengthRankedCoverage, false);
  assert.equal(policy.ruleCoverage.includes('date-1900-2099'), true);
});

