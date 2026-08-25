import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import {
  countPinCompletions,
  createPinModel,
  createPinRiskIndex,
  detectWeakPinPatterns,
  generatePin,
} from '../../src/v2/pin-model.mjs';

const sourcePayloadText = await readFile(
  new URL('../../assets/data/pin-risk.v1.json', import.meta.url),
  'utf8',
);
const sourcePayload = JSON.parse(sourcePayloadText);
const riskIndex = createPinRiskIndex(sourcePayload);

function hasSequentialRun(value) {
  let direction = 0;
  let runLength = 1;
  for (let index = 1; index < value.length; index += 1) {
    const delta = Number(value[index]) - Number(value[index - 1]);
    const nextDirection = delta === 1 ? 1 : delta === -1 ? -1 : 0;
    if (nextDirection === 0) {
      direction = 0;
      runLength = 1;
    } else {
      runLength = nextDirection === direction ? runLength + 1 : 2;
      direction = nextDirection;
    }
    if (runLength > 2) return true;
  }
  return false;
}

function satisfiesBaseConstraints(pin, config) {
  if (!config.allowLeadingZero && pin.startsWith('0')) return false;
  if (!config.allowRepeated && new Set(pin).size !== pin.length) return false;
  if (config.limitSequential && hasSequentialRun(pin)) return false;
  return true;
}

function directCount(config) {
  const limit = 10 ** config.length;
  let count = 0n;
  for (let value = 0; value < limit; value += 1) {
    const pin = String(value).padStart(config.length, '0');
    if (satisfiesBaseConstraints(pin, config)) count += 1n;
  }
  return count;
}

function directBlockedCount(config, index) {
  const limit = 10 ** config.length;
  let count = 0n;
  for (let value = 0; value < limit; value += 1) {
    const pin = String(value).padStart(config.length, '0');
    if (!satisfiesBaseConstraints(pin, config)) continue;
    if (detectWeakPinPatterns(pin).length || index.isRankBlocked(pin)) count += 1n;
  }
  return count;
}

function cyclingCrypto() {
  let value = 17;
  return {
    getRandomValues(target) {
      for (let index = 0; index < target.length; index += 1) {
        value = (value * 73 + 41) & 0xff;
        target[index] = value;
      }
      return target;
    },
  };
}

test('默认六位模型返回审计确认的精确约束空间', () => {
  const config = {
    length: 6,
    allowLeadingZero: true,
    allowRepeated: true,
    limitSequential: true,
    blockWeak: false,
  };
  const model = createPinModel(config);

  assert.equal(model.searchSpace, 940738n);
  assert.equal(countPinCompletions(config), 940738n);
  assert.equal(model.minEntropyBits, Math.log2(940738));
  assert.equal(model.shannonEntropyBits, model.minEntropyBits);
});

test('四位和六位 DP 与独立直接枚举完全一致', () => {
  const cases = [
    { length: 4, allowLeadingZero: true, allowRepeated: true, limitSequential: true, blockWeak: false },
    { length: 4, allowLeadingZero: false, allowRepeated: false, limitSequential: true, blockWeak: false },
    { length: 6, allowLeadingZero: false, allowRepeated: true, limitSequential: true, blockWeak: false },
  ];

  for (const config of cases) {
    assert.equal(countPinCompletions(config), directCount(config), JSON.stringify(config));
  }
});

test('前导零和禁止重复均进入精确状态空间', () => {
  assert.equal(countPinCompletions({
    length: 4,
    allowLeadingZero: false,
    allowRepeated: true,
    limitSequential: false,
    blockWeak: false,
  }), 9000n);
  assert.equal(countPinCompletions({
    length: 4,
    allowLeadingZero: true,
    allowRepeated: false,
    limitSequential: false,
    blockWeak: false,
  }), 5040n);
});

test('completion count 按前缀分支精确分解总空间', () => {
  const model = createPinModel({
    length: 6,
    allowLeadingZero: true,
    allowRepeated: true,
    limitSequential: true,
    blockWeak: false,
  });
  const branches = model.branchCompletionCounts('');

  assert.equal(branches.reduce((sum, branch) => sum + branch.count, 0n), model.searchSpace);
  assert.ok(branches.some((branch) => branch.count !== branches[0].count));
  assert.equal(model.completionCount('12'), 8629n);
});

test('弱模式检测覆盖全部支持长度和所有规则类别', () => {
  assert.ok(detectWeakPinPatterns('1111').includes('全部重复'));
  assert.ok(detectWeakPinPatterns('11111111').includes('全部重复'));
  assert.ok(detectWeakPinPatterns('12121212').includes('短周期循环'));
  assert.ok(detectWeakPinPatterns('25802580').includes('键盘路径'));
  assert.ok(detectWeakPinPatterns('082519').includes('日期样式'));
  assert.ok(detectWeakPinPatterns('20240229').includes('日期样式'));
  assert.ok(detectWeakPinPatterns('12345678').includes('连续数字'));
  assert.ok(detectWeakPinPatterns('012345678901').includes('连续数字'));
  assert.ok(detectWeakPinPatterns('000000000000').includes('全部重复'));
  assert.ok(detectWeakPinPatterns('12'.repeat(16)).includes('短周期循环'));
  assert.deepEqual(detectWeakPinPatterns('12a4'), []);
  assert.deepEqual(detectWeakPinPatterns('123'), []);
  assert.deepEqual(detectWeakPinPatterns('1'.repeat(33)), []);
});

test('风险索引保留版本、计数、阈值、来源哈希与频率排名', () => {
  assert.equal(riskIndex.status, 'ready');
  assert.equal(riskIndex.version, sourcePayload.version);
  assert.equal(riskIndex.metadata.fourDigitCount, 10000);
  assert.equal(riskIndex.metadata.sixDigitCount, 68202);
  assert.equal(riskIndex.metadata.fourDigitBlockRank, 500);
  assert.equal(riskIndex.metadata.sixDigitBlockRank, 1000);
  assert.equal(riskIndex.sources.fourDigit.sha256, sourcePayload.sources.fourDigit.sha256);
  assert.ok(riskIndex.rank('1234') > 0);
  assert.equal(riskIndex.rank('583907'), null);
  assert.equal(riskIndex.isRankBlocked('583907'), false);
  assert.equal(riskIndex.rank('12345'), null);
});

test('创建风险索引不会冻结或改写调用方载荷', () => {
  const cloned = structuredClone(sourcePayload);
  createPinRiskIndex(cloned);

  assert.equal(Object.isFrozen(cloned), false);
  assert.equal(Object.isFrozen(cloned.sources.fourDigit), false);
  cloned.sources.fourDigit.url = 'local-test';
  assert.equal(cloned.sources.fourDigit.url, 'local-test');
});

test('blockWeak 要求完整风险模型 ready', () => {
  const config = {
    length: 4,
    allowLeadingZero: true,
    allowRepeated: true,
    limitSequential: false,
    blockWeak: true,
  };

  assert.throws(() => createPinModel(config), /ready/);
  assert.throws(() => generatePin(config, { status: 'loading' }, cyclingCrypto()), /ready/);
});

test('blockWeak 精确扣除合法交集且没有固定 bit 修正', () => {
  const openConfig = {
    length: 4,
    allowLeadingZero: true,
    allowRepeated: true,
    limitSequential: false,
    blockWeak: false,
  };
  const blockedConfig = { ...openConfig, blockWeak: true };
  const open = createPinModel(openConfig);
  const blocked = createPinModel(blockedConfig, riskIndex);
  const expectedBlocked = directBlockedCount(blockedConfig, riskIndex);

  assert.equal(blocked.baseSearchSpace, open.searchSpace);
  assert.equal(blocked.blockedCount, expectedBlocked);
  assert.equal(blocked.searchSpace, open.searchSpace - expectedBlocked);
  assert.equal(blocked.minEntropyBits, Math.log2(Number(blocked.searchSpace)));
  assert.notEqual(blocked.minEntropyBits, open.minEntropyBits - 0.03);
});

test('六位 blockWeak 的排名、日期、循环和键盘规则并集与直接枚举一致', () => {
  const config = {
    length: 6,
    allowLeadingZero: true,
    allowRepeated: true,
    limitSequential: true,
    blockWeak: true,
  };
  const model = createPinModel(config, riskIndex);

  assert.equal(model.blockedCount, directBlockedCount(config, riskIndex));
  assert.equal(model.searchSpace, model.baseSearchSpace - model.blockedCount);
});

test('风险排名只作用于四位和六位且使用各自阈值', () => {
  assert.equal(riskIndex.isRankBlocked('1234'), true);
  assert.equal(riskIndex.isRankBlocked('123456'), true);
  assert.equal(riskIndex.isRankBlocked('583907'), false);
  assert.equal(riskIndex.isRankBlocked('11111111'), false);

  const fourBytes = Buffer.from(sourcePayload.fourDigitRanks, 'base64');
  const fourView = new DataView(fourBytes.buffer, fourBytes.byteOffset, fourBytes.byteLength);
  let rank500 = null;
  let rank501 = null;
  for (let value = 0; value < 10_000; value += 1) {
    const rank = fourView.getUint16(value * 2, true);
    if (rank === 500) rank500 = String(value).padStart(4, '0');
    if (rank === 501) rank501 = String(value).padStart(4, '0');
  }
  const sixBytes = Buffer.from(sourcePayload.sixDigitValues, 'base64');
  const sixView = new DataView(sixBytes.buffer, sixBytes.byteOffset, sixBytes.byteLength);
  const rank1000 = String(sixView.getUint32(999 * 4, true)).padStart(6, '0');
  const rank1001 = String(sixView.getUint32(1000 * 4, true)).padStart(6, '0');

  assert.equal(riskIndex.isRankBlocked(rank500), true);
  assert.equal(riskIndex.isRankBlocked(rank501), false);
  assert.equal(riskIndex.isRankBlocked(rank1000), true);
  assert.equal(riskIndex.isRankBlocked(rank1001), false);
});

test('8/12/32 位弱模式计数保持精确且不会枚举完整空间', () => {
  for (const length of [8, 12, 32]) {
    const config = {
      length,
      allowLeadingZero: true,
      allowRepeated: true,
      limitSequential: true,
      blockWeak: true,
    };
    const model = createPinModel(config, riskIndex);
    assert.equal(model.searchSpace, model.baseSearchSpace - model.blockedCount);
    assert.ok(model.blockedCount > 0n);
    assert.ok(model.searchSpace > 0n);
  }
});

test('生成器通过 completion-count 权重均匀选择基础空间并排除弱终态', () => {
  const configs = [
    { length: 4, allowLeadingZero: false, allowRepeated: false, limitSequential: true, blockWeak: false },
    { length: 8, allowLeadingZero: true, allowRepeated: true, limitSequential: true, blockWeak: true },
    { length: 12, allowLeadingZero: true, allowRepeated: true, limitSequential: true, blockWeak: true },
  ];

  for (const config of configs) {
    const result = generatePin(config, config.blockWeak ? riskIndex : undefined, cyclingCrypto());
    assert.equal(result.type, 'pin');
    assert.equal(result.value.length, config.length);
    assert.equal(satisfiesBaseConstraints(result.value, config), true);
    assert.equal(config.blockWeak ? detectWeakPinPatterns(result.value).length : 0, 0);
    assert.equal(config.blockWeak ? riskIndex.isRankBlocked(result.value) : false, false);
    assert.equal(result.generationModel.searchSpace, createPinModel(config, config.blockWeak ? riskIndex : undefined).searchSpace);
    assert.equal(Object.isFrozen(result.generationModel), true);
  }
});

test('非法长度、布尔设置和无可行空间会给出明确错误', () => {
  assert.throws(() => createPinModel({ length: 3 }), /4.*32/);
  assert.throws(() => createPinModel({ length: 33 }), /4.*32/);
  assert.throws(() => createPinModel({ length: 12, allowRepeated: false }), /10/);
  assert.throws(() => createPinModel({ length: 4, allowRepeated: 'yes' }), /allowRepeated/);
  assert.throws(() => createPinRiskIndex({}), /格式/);
});

test('classic-script 风险资产可复现并保持源载荷完整', async () => {
  const assetText = await readFile(new URL('../../assets/v2/pin-risk.v2.js', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(assetText, context);
  const built = context.PasswordGeneratorV2Assets.pinRisk;

  assert.equal(built.version, sourcePayload.version);
  assert.equal(built.metadata.fourDigitCount, sourcePayload.metadata.fourDigitCount);
  assert.equal(built.metadata.sixDigitBlockRank, sourcePayload.metadata.sixDigitBlockRank);
  assert.equal(built.sources.sixDigit.sha256, sourcePayload.sources.sixDigit.sha256);
  assert.equal(built.sourceSha256, createHash('sha256').update(sourcePayloadText).digest('hex'));
  assert.equal(built.fourDigitRanks, sourcePayload.fourDigitRanks);
  assert.equal(built.sixDigitValues, sourcePayload.sixDigitValues);
  assert.equal(Object.isFrozen(built), true);
  assert.equal(Object.isFrozen(built.metadata), true);
});
