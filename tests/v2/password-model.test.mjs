import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countPasswordOutputs,
  createPasswordModel,
  generatePassword,
  normalizePasswordConfig,
} from '../../src/v2/password-model.mjs';

function classFor(character, pools) {
  return Object.entries(pools).find(([, pool]) => pool.includes(character))?.[0] || null;
}

function isValidPassword(value, config) {
  const classes = [...value].map((character) => classFor(character, config.pools));
  if (classes.some((name) => !name)) return false;
  if (!config.startClasses.includes(classes[0])) return false;
  if (!config.endClasses.includes(classes.at(-1))) return false;
  if (classes[0] === 'space' || classes.at(-1) === 'space') return false;
  if (value.includes('  ')) return false;
  if (!config.allowRepeated && new Set(value).size !== value.length) return false;
  if (config.requiredClasses.some((name) => !classes.includes(name))) return false;
  const symbolCount = classes.filter((name) => name === 'symbol').length;
  return config.symbolCounts.includes(symbolCount);
}

function enumerate(config) {
  const alphabet = [...config.enabledClasses, 'space'].flatMap((name) => config.pools[name]);
  const values = [];
  function visit(prefix) {
    if (prefix.length === config.length) {
      if (isValidPassword(prefix, config)) values.push(prefix);
      return;
    }
    for (const character of alphabet) visit(prefix + character);
  }
  visit('');
  return values;
}

function zeroCrypto() {
  return {
    getRandomValues(target) {
      target.fill(0);
      return target;
    },
  };
}

function seededCrypto(initialSeed = 1) {
  let seed = initialSeed >>> 0;
  return {
    getRandomValues(target) {
      for (let index = 0; index < target.length; index += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        target[index] = seed >>> 24;
      }
      return target;
    },
  };
}

test('规范化字符池会去重、排除字符并消除类别重叠', () => {
  const normalized = normalizePasswordConfig({
    length: 4,
    pools: { lower: 'aabi', upper: 'AA', digit: '112', symbol: '!a1!!', space: ' ' },
    excludedCharacters: 'i',
    enabledClasses: ['lower', 'upper', 'digit', 'symbol'],
    requiredClasses: [],
    symbolRatioRange: [0, 100],
    startClasses: ['lower', 'upper', 'digit', 'symbol'],
    endClasses: ['lower', 'upper', 'digit', 'symbol'],
    allowRepeated: true,
  });

  assert.deepEqual(normalized.pools, {
    lower: ['a', 'b'],
    upper: ['A'],
    digit: ['1', '2'],
    symbol: ['!'],
    space: [' '],
  });
});

test('默认字符池、语义化首尾约束和 requireEach 会被完整规范化', () => {
  const normalized = normalizePasswordConfig({
    length: 8,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    symbolPool: '!1',
    allowSpace: true,
    requireEach: true,
    symbolRatioMode: 'fixed',
    fixedSymbolCount: 1,
    startsWith: 'letter',
    endsWith: 'digit',
  });

  assert.equal(normalized.pools.lower.length, 26);
  assert.equal(normalized.pools.upper.length, 26);
  assert.equal(normalized.pools.digit.length, 10);
  assert.deepEqual(normalized.pools.symbol, ['!']);
  assert.deepEqual(normalized.pools.space, [' ']);
  assert.deepEqual(normalized.requiredClasses, ['lower', 'upper', 'digit', 'symbol']);
  assert.deepEqual(normalized.startClasses, ['lower', 'upper']);
  assert.deepEqual(normalized.endClasses, ['digit']);
});

test('禁用类别会从规范化字符池、首尾约束、计数与生成中彻底移除', () => {
  const config = {
    length: 3,
    pools: { lower: 'a', upper: 'X', digit: '7', symbol: '!', space: '' },
    enabledClasses: ['lower'],
    requiredClasses: [],
    symbolRatioRange: [0, 0],
    startClasses: ['lower', 'upper'],
    endClasses: ['lower', 'digit'],
    allowRepeated: true,
  };
  const normalized = normalizePasswordConfig(config);
  const result = generatePassword(config, zeroCrypto());

  assert.deepEqual(normalized.pools.upper, []);
  assert.deepEqual(normalized.pools.digit, []);
  assert.deepEqual(normalized.pools.symbol, []);
  assert.deepEqual(normalized.startClasses, ['lower']);
  assert.deepEqual(normalized.endClasses, ['lower']);
  assert.equal(createPasswordModel(config).searchSpace, 1n);
  assert.equal(result.value, 'aaa');
});

test('无效配置在开始计数前给出具体错误', () => {
  assert.throws(() => normalizePasswordConfig({ length: 0 }), /密码长度/);
  assert.throws(() => normalizePasswordConfig({
    length: 4,
    pools: { lower: '', upper: '', digit: '', symbol: '', space: '' },
    enabledClasses: [],
  }), /至少提供一个/);
  assert.throws(() => normalizePasswordConfig({
    length: 4,
    pools: { lower: '', upper: '', digit: '', symbol: '', space: '' },
    enabledClasses: ['lower'],
  }), /至少提供一个|没有可用字符/);
  assert.throws(() => normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '', space: '' },
    enabledClasses: ['lower'],
    requiredClasses: ['digit'],
  }), /必选字符类型 digit 未启用/);
  assert.throws(() => normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '', space: '' },
    enabledClasses: ['lower'],
    startsWith: 'digit',
  }), /首尾字符约束/);
  assert.throws(() => normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '!', space: '' },
    enabledClasses: ['lower', 'symbol'],
    symbolRatioRange: [80, 20],
  }), /符号比例/);
  assert.throws(() => normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '', space: '' },
    enabledClasses: ['lower'],
    symbolRatioMode: 'fixed',
    fixedSymbolCount: 1,
  }), /固定符号数量必须为 0/);
  assert.throws(() => normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '', space: ' ' },
    enabledClasses: ['lower'],
    forbidAdjacentSpaces: false,
  }), /空格固定为仅内部、不可相邻/);
  assert.throws(() => normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '', space: '' },
    enabledClasses: ['emoji'],
  }), /未知字符类型/);
});

test('小字符池的精确计数与穷举合法结果完全一致', () => {
  const config = normalizePasswordConfig({
    length: 3,
    pools: { lower: 'ab', upper: 'X', digit: '7', symbol: '!', space: '' },
    enabledClasses: ['lower', 'upper', 'digit', 'symbol'],
    requiredClasses: ['lower', 'symbol'],
    symbolRatioRange: [33, 34],
    startClasses: ['lower', 'upper', 'digit'],
    endClasses: ['lower', 'upper', 'digit', 'symbol'],
    allowRepeated: true,
  });
  const expected = enumerate(config);
  const model = createPasswordModel(config);

  assert.equal(model.searchSpace, BigInt(expected.length));
  assert.equal(countPasswordOutputs(config), BigInt(expected.length));
  assert.equal(model.minEntropyBits, Math.log2(expected.length));
  assert.equal(model.shannonEntropyBits, model.minEntropyBits);
});

test('符号比例范围会把每个可行符号数量纳入同一个输出空间', () => {
  const config = normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '!?', space: '' },
    enabledClasses: ['lower', 'symbol'],
    requiredClasses: [],
    symbolRatioRange: [25, 75],
    startClasses: ['lower', 'symbol'],
    endClasses: ['lower', 'symbol'],
    allowRepeated: true,
  });
  const expected = enumerate(config);

  assert.deepEqual(config.symbolCounts, [1, 2, 3]);
  assert.equal(createPasswordModel(config).searchSpace, BigInt(expected.length));
});

test('只有一个自定义符号时严格按单字符池计算', () => {
  const config = normalizePasswordConfig({
    length: 6,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '!', space: '' },
    enabledClasses: ['lower', 'symbol'],
    requiredClasses: ['symbol'],
    symbolRatioMode: 'fixed',
    fixedSymbolCount: 2,
    startClasses: ['lower'],
    endClasses: ['lower'],
    allowRepeated: true,
  });

  assert.equal(config.pools.symbol.length, 1);
  assert.equal(createPasswordModel(config).searchSpace, 96n);
});

test('requireEach、首尾边界和禁止重复共同进入精确计数', () => {
  const config = normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: 'XY', digit: '12', symbol: '!', space: '' },
    enabledClasses: ['lower', 'upper', 'digit', 'symbol'],
    requireEach: true,
    symbolRatioMode: 'fixed',
    fixedSymbolCount: 1,
    startsWith: 'letter',
    endsWith: 'digit',
    allowRepeated: false,
  });
  const expected = enumerate(config);

  assert.equal(createPasswordModel(config).searchSpace, BigInt(expected.length));
});

test('Space 只允许内部非相邻位置并参与精确计数', () => {
  const config = normalizePasswordConfig({
    length: 4,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '', space: ' ' },
    enabledClasses: ['lower'],
    requiredClasses: [],
    symbolRatioRange: [0, 0],
    startClasses: ['lower'],
    endClasses: ['lower'],
    allowRepeated: true,
  });
  const expected = enumerate(config);

  assert.ok(expected.some((value) => value.includes(' ')));
  assert.equal(createPasswordModel(config).searchSpace, BigInt(expected.length));
});

test('重复字符快速路径在无 Space、全符号范围、固定符号和部分范围下均与穷举一致', () => {
  const cases = [
    {
      length: 5,
      pools: { lower: 'ab', upper: 'X', digit: '', symbol: '!?', space: '' },
      enabledClasses: ['lower', 'upper', 'symbol'],
      requiredClasses: ['lower', 'symbol'],
      symbolRatioRange: [20, 80],
      startClasses: ['lower', 'upper'],
      endClasses: ['lower', 'symbol'],
      allowRepeated: true,
    },
    {
      length: 5,
      pools: { lower: 'ab', upper: 'X', digit: '', symbol: '!?', space: ' ' },
      enabledClasses: ['lower', 'upper', 'symbol'],
      requiredClasses: ['lower', 'upper', 'symbol'],
      symbolRatioRange: [0, 100],
      startClasses: ['lower', 'upper', 'symbol'],
      endClasses: ['lower', 'upper', 'symbol'],
      allowRepeated: true,
    },
    {
      length: 6,
      pools: { lower: 'ab', upper: 'X', digit: '', symbol: '!?', space: ' ' },
      enabledClasses: ['lower', 'upper', 'symbol'],
      requiredClasses: ['lower', 'symbol'],
      symbolRatioMode: 'fixed',
      fixedSymbolCount: 2,
      startClasses: ['lower', 'upper'],
      endClasses: ['lower', 'symbol'],
      allowRepeated: true,
    },
    {
      length: 6,
      pools: { lower: 'ab', upper: 'X', digit: '', symbol: '!?', space: ' ' },
      enabledClasses: ['lower', 'upper', 'symbol'],
      requiredClasses: ['lower', 'symbol'],
      symbolRatioRange: [33, 67],
      startClasses: ['lower', 'upper', 'symbol'],
      endClasses: ['lower', 'upper', 'symbol'],
      allowRepeated: true,
    },
  ];

  for (const source of cases) {
    const normalized = normalizePasswordConfig(source);
    const expected = enumerate(normalized);
    assert.equal(createPasswordModel(normalized).searchSpace, BigInt(expected.length));
    assert.equal(countPasswordOutputs(normalized), BigInt(expected.length));
  }
});

test('1024 位全范围 Space 精确模型在五秒内完成', { timeout: 10_000 }, () => {
  const started = performance.now();
  const model = createPasswordModel({
    length: 1024,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    allowSpace: true,
    allowRepeated: true,
    requireEach: true,
    symbolRatioRange: [0, 100],
  });
  const elapsed = performance.now() - started;

  assert.ok(model.searchSpace > 0n);
  assert.ok(elapsed < 5_000, `1024 位模型耗时 ${elapsed.toFixed(0)}ms`);
});

test('全范围快速采样始终满足 requireEach、首尾和 Space 约束', () => {
  const config = {
    length: 6,
    pools: { lower: 'ab', upper: 'X', digit: '', symbol: '!?', space: ' ' },
    enabledClasses: ['lower', 'upper', 'symbol'],
    requiredClasses: ['lower', 'upper', 'symbol'],
    symbolRatioRange: [0, 100],
    startClasses: ['lower', 'upper', 'symbol'],
    endClasses: ['lower', 'upper', 'symbol'],
    allowRepeated: true,
  };
  const normalized = normalizePasswordConfig(config);
  const cryptoLike = seededCrypto(0x1234abcd);

  for (let index = 0; index < 128; index += 1) {
    assert.equal(isValidPassword(generatePassword(config, cryptoLike, () => index).value, normalized), true);
  }
});

test('长度为 1 的全范围快速采样仍服从 requireEach', () => {
  const result = generatePassword({
    length: 1,
    pools: { lower: 'a', upper: 'X', digit: '', symbol: '!', space: '' },
    enabledClasses: ['lower', 'upper', 'symbol'],
    requiredClasses: ['upper'],
    symbolRatioRange: [0, 100],
    startClasses: ['lower', 'upper', 'symbol'],
    endClasses: ['lower', 'upper', 'symbol'],
    allowRepeated: true,
  }, zeroCrypto());

  assert.equal(result.value, 'X');
});

test('4096 位全范围 Space 可在五秒内精确生成', { timeout: 10_000 }, () => {
  const started = performance.now();
  const result = generatePassword({
    length: 4096,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    allowSpace: true,
    allowRepeated: true,
    requireEach: true,
    symbolRatioRange: [0, 100],
  });
  const elapsed = performance.now() - started;

  assert.equal([...result.value].length, 4096);
  assert.ok(elapsed < 5_000, `4096 位生成耗时 ${elapsed.toFixed(0)}ms`);
});

test('禁止重复时长度超过唯一字符数会拒绝', () => {
  assert.throws(() => normalizePasswordConfig({
    length: 5,
    pools: { lower: 'ab', upper: 'X', digit: '7', symbol: '', space: '' },
    enabledClasses: ['lower', 'upper', 'digit'],
    requiredClasses: [],
    symbolRatioRange: [0, 0],
    startClasses: ['lower', 'upper', 'digit'],
    endClasses: ['lower', 'upper', 'digit'],
    allowRepeated: false,
  }), /唯一字符/);
});

test('生成结果携带精确且不可变的 generationModel', () => {
  const config = {
    length: 3,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '!', space: '' },
    enabledClasses: ['lower', 'symbol'],
    requiredClasses: ['symbol'],
    symbolRatioMode: 'fixed',
    fixedSymbolCount: 1,
    startClasses: ['lower'],
    endClasses: ['lower', 'symbol'],
    allowRepeated: true,
  };
  const result = generatePassword(config, zeroCrypto(), () => 1_700_000_000_000);

  assert.equal(result.type, 'password');
  assert.equal(result.generationModel.searchSpace, createPasswordModel(config).searchSpace);
  assert.equal(Object.isFrozen(result.generationModel), true);
  assert.equal(isValidPassword(result.value, normalizePasswordConfig(config)), true);
  assert.equal(result.createdAt, 1_700_000_000_000);
  assert.match(result.id, /1700000000000/);
});

test('长度为 1 时首尾约束由同一个字符同时满足', () => {
  const config = {
    length: 1,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '', space: '' },
    enabledClasses: ['lower'],
    requiredClasses: ['lower'],
    symbolRatioRange: [0, 0],
    startClasses: ['lower'],
    endClasses: ['lower'],
    allowRepeated: false,
  };
  const model = createPasswordModel(config);
  const result = generatePassword(config, zeroCrypto());

  assert.equal(model.searchSpace, 2n);
  assert.equal(result.value, 'a');
});

test('当合法输出必须包含空格时生成器仍保持边界、非相邻和不重复约束', () => {
  const config = {
    length: 3,
    pools: { lower: 'ab', upper: '', digit: '', symbol: '', space: ' ' },
    enabledClasses: ['lower'],
    requiredClasses: ['lower'],
    symbolRatioRange: [0, 0],
    startClasses: ['lower'],
    endClasses: ['lower'],
    allowRepeated: false,
  };
  const normalized = normalizePasswordConfig(config);
  const result = generatePassword(config, zeroCrypto());

  assert.equal(result.value, 'a b');
  assert.equal(isValidPassword(result.value, normalized), true);
  assert.equal(createPasswordModel(config).searchSpace, 2n);
});

test('多类别 requireEach 生成路径会逐类保留可完成后缀', () => {
  const config = {
    length: 4,
    pools: { lower: 'ab', upper: 'XY', digit: '12', symbol: '!', space: '' },
    enabledClasses: ['lower', 'upper', 'digit', 'symbol'],
    requireEach: true,
    symbolRatioMode: 'fixed',
    fixedSymbolCount: 1,
    startsWith: 'letter',
    endsWith: 'digit',
    allowRepeated: false,
  };
  const normalized = normalizePasswordConfig(config);
  const result = generatePassword(config, zeroCrypto());

  assert.equal(isValidPassword(result.value, normalized), true);
  assert.deepEqual(new Set([...result.value].map((character) => classFor(character, normalized.pools))),
    new Set(['lower', 'upper', 'digit', 'symbol']));
});

test('零合法空间会在生成前给出明确错误', () => {
  assert.throws(() => createPasswordModel({
    length: 2,
    pools: { lower: 'a', upper: '', digit: '', symbol: '!', space: '' },
    enabledClasses: ['lower', 'symbol'],
    requiredClasses: ['lower', 'symbol'],
    symbolRatioMode: 'fixed',
    fixedSymbolCount: 1,
    startClasses: ['symbol'],
    endClasses: ['symbol'],
    allowRepeated: true,
  }), /没有合法输出/);
});
