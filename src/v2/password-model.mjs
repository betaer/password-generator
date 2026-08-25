import {
  chooseBigInt,
  fallingFactorialBigInt,
  log2BigInt,
} from './combinatorics.mjs';
import {
  secureBigIntBelow,
  secureInt,
  weightedBigIntChoice,
} from './random-core.mjs';
import { createGenerationResult, deepFreeze } from './result-model.mjs';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const NON_SPACE_CLASSES = Object.freeze(['lower', 'upper', 'digit', 'symbol']);
const ALL_CLASSES = Object.freeze([...NON_SPACE_CLASSES, 'space']);
const CLASS_BIT = Object.freeze(Object.fromEntries(NON_SPACE_CLASSES.map((name, index) => [name, 1 << index])));

let resultSequence = 0;
const powerCache = new Map();
const combinationCache = new Map();
const rangeCountCache = new Map();

function uniqueCharacters(value) {
  return [...new Set([...String(value ?? '')])];
}

function integer(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label}必须是 ${minimum}～${maximum} 之间的整数。`);
  }
  return number;
}

function boundaryClasses(value, pools, enabledClasses) {
  const enabled = new Set(enabledClasses);
  if (Array.isArray(value)) return [...new Set(value)].filter((name) => enabled.has(name) && pools[name].length);
  if (value === 'letter') return ['lower', 'upper'].filter((name) => enabled.has(name) && pools[name].length);
  if (value === 'digit') return enabled.has('digit') && pools.digit.length ? ['digit'] : [];
  if (value === 'symbol') return enabled.has('symbol') && pools.symbol.length ? ['symbol'] : [];
  return enabledClasses.filter((name) => NON_SPACE_CLASSES.includes(name) && pools[name].length);
}

function sourcePools(config) {
  if (config.pools) {
    return {
      lower: config.pools.lower ?? '',
      upper: config.pools.upper ?? '',
      digit: config.pools.digit ?? '',
      symbol: config.pools.symbol ?? '',
      space: config.pools.space ?? '',
    };
  }
  return {
    lower: config.lowercase === false ? '' : LOWER,
    upper: config.uppercase === false ? '' : UPPER,
    digit: config.digits === false ? '' : DIGITS,
    symbol: config.symbols === false ? '' : (config.symbolPool ?? config.customSymbols ?? SYMBOLS),
    space: config.allowSpace ? ' ' : '',
  };
}

function normalizedMarker(config) {
  return Boolean(config && config.__passwordModelV2 === true);
}

export function normalizePasswordConfig(input = {}) {
  if (normalizedMarker(input)) return input;
  const length = integer(input.length ?? 20, '密码长度', 1, 4096);
  const excluded = new Set(uniqueCharacters(input.excludedCharacters ?? input.excluded ?? ''));
  const rawPools = sourcePools(input);
  const pools = {};
  const claimed = new Set();

  for (const name of ALL_CLASSES) {
    const values = uniqueCharacters(rawPools[name]).filter((character) => !excluded.has(character));
    const allowed = name === 'space'
      ? values.filter((character) => character === ' ')
      : values.filter((character) => character !== ' ' && !claimed.has(character));
    pools[name] = allowed;
    allowed.forEach((character) => claimed.add(character));
  }

  const requestedEnabled = Array.isArray(input.enabledClasses)
    ? [...new Set(input.enabledClasses)]
    : [
        input.lowercase === false ? null : 'lower',
        input.uppercase === false ? null : 'upper',
        input.digits === false ? null : 'digit',
        input.symbols === false ? null : 'symbol',
      ].filter(Boolean);
  for (const name of requestedEnabled) {
    if (!NON_SPACE_CLASSES.includes(name)) throw new RangeError(`未知字符类型：${name}`);
  }
  const enabledClasses = requestedEnabled.filter((name) => NON_SPACE_CLASSES.includes(name) && pools[name].length);
  if (!enabledClasses.length) throw new RangeError('请至少提供一个非空字符类型。');

  for (const name of requestedEnabled) {
    if (NON_SPACE_CLASSES.includes(name) && !pools[name].length) {
      throw new RangeError(`字符类型 ${name} 没有可用字符。`);
    }
  }
  for (const name of NON_SPACE_CLASSES) {
    if (!enabledClasses.includes(name)) pools[name] = [];
  }

  const requiredSource = Array.isArray(input.requiredClasses)
    ? input.requiredClasses
    : input.requireEach ? enabledClasses : [];
  const requiredClasses = [...new Set(requiredSource)].filter((name) => NON_SPACE_CLASSES.includes(name));
  for (const name of requiredClasses) {
    if (!enabledClasses.includes(name)) throw new RangeError(`必选字符类型 ${name} 未启用。`);
  }

  const startClasses = boundaryClasses(input.startClasses ?? input.startsWith ?? 'any', pools, enabledClasses);
  const endClasses = boundaryClasses(input.endClasses ?? input.endsWith ?? 'any', pools, enabledClasses);
  if (!startClasses.length || !endClasses.length) throw new RangeError('首尾字符约束没有可用字符。');

  let symbolCounts;
  if (!enabledClasses.includes('symbol')) {
    if ((input.symbolRatioMode === 'fixed' || input.fixedSymbolCount !== undefined)
      && Number(input.fixedSymbolCount ?? 0) !== 0) {
      throw new RangeError('未启用符号字符池，固定符号数量必须为 0。');
    }
    symbolCounts = [0];
  } else if (input.symbolRatioMode === 'fixed' || input.fixedSymbolCount !== undefined) {
    symbolCounts = [integer(input.fixedSymbolCount ?? 0, '固定符号数量', 0, length)];
  } else {
    const range = Array.isArray(input.symbolRatioRange) ? input.symbolRatioRange : [0, 100];
    const minimum = Number(range[0]);
    const maximum = Number(range[1]);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum > 100 || minimum > maximum) {
      throw new RangeError('符号比例必须是 0%～100% 的有效范围。');
    }
    const minimumCount = Math.ceil(length * minimum / 100);
    const maximumCount = Math.floor(length * maximum / 100);
    symbolCounts = Array.from({ length: Math.max(0, maximumCount - minimumCount + 1) }, (_, index) => minimumCount + index);
  }
  if (!symbolCounts.length) throw new RangeError('当前长度下没有整数符号数量满足比例范围。');
  const allowRepeated = input.allowRepeated !== false;
  if (input.forbidAdjacentSpaces === false) {
    throw new RangeError('V2 密码中的空格固定为仅内部、不可相邻。');
  }
  const totalUnique = Object.values(pools).reduce((sum, pool) => sum + pool.length, 0);
  if (!allowRepeated && length > totalUnique) {
    throw new RangeError(`禁止重复字符时，当前唯一字符池最多生成 ${totalUnique} 位。`);
  }

  return deepFreeze({
    __passwordModelV2: true,
    length,
    pools,
    enabledClasses,
    requiredClasses,
    symbolCounts,
    startClasses,
    endClasses,
    allowRepeated,
    excludedCharacters: [...excluded],
    forbidAdjacentSpaces: true,
  });
}

function powerBigInt(base, exponent) {
  if (!powerCache.has(base)) powerCache.set(base, [1n]);
  const values = powerCache.get(base);
  const factor = BigInt(base);
  for (let index = values.length; index <= exponent; index += 1) {
    values[index] = values[index - 1] * factor;
  }
  return values[exponent];
}

function cachedChooseBigInt(n, k) {
  if (k < 0 || k > n) return 0n;
  const normalizedK = Math.min(k, n - k);
  const key = `${n}:${normalizedK}`;
  if (!combinationCache.has(key)) {
    if (combinationCache.size > 50_000) combinationCache.clear();
    combinationCache.set(key, chooseBigInt(n, normalizedK));
  }
  return combinationCache.get(key);
}

function clampSymbolRange(length, minimum, maximum) {
  return [Math.max(0, minimum), Math.min(length, maximum)];
}

function fullNoAdjacentCount(length, nonSpaceWays, spaceWays, previousSpace = false) {
  const multiply = (left, right) => [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
  ];
  const nonSpace = BigInt(nonSpaceWays);
  const space = BigInt(spaceWays);
  let factor = [nonSpace, nonSpace, space, 0n];
  let power = length;
  let result = [1n, 0n, 0n, 1n];
  while (power > 0) {
    if (power % 2 === 1) result = multiply(result, factor);
    power = Math.floor(power / 2);
    if (power > 0) factor = multiply(factor, factor);
  }
  const initialNormal = previousSpace ? 0n : 1n;
  const initialSpace = previousSpace ? 1n : 0n;
  const finalNormal = result[0] * initialNormal + result[1] * initialSpace;
  const finalSpace = result[2] * initialNormal + result[3] * initialSpace;
  return finalNormal + finalSpace;
}

function binomialTerm(length, symbolCount, nonSymbolWays, symbolWays) {
  if (symbolCount < 0 || symbolCount > length) return 0n;
  if (symbolCount > 0 && symbolWays === 0) return 0n;
  const nonSymbolCount = length - symbolCount;
  if (nonSymbolCount > 0 && nonSymbolWays === 0) return 0n;
  return cachedChooseBigInt(length, symbolCount)
    * powerBigInt(symbolWays, symbolCount)
    * powerBigInt(nonSymbolWays, nonSymbolCount);
}

function sumBinomialTerms(length, nonSymbolWays, symbolWays, minimum, maximum) {
  const [lower, upper] = clampSymbolRange(length, minimum, maximum);
  if (lower > upper) return 0n;
  if (lower === 0 && upper === length) return powerBigInt(nonSymbolWays + symbolWays, length);
  if (nonSymbolWays === 0) return lower <= length && length <= upper ? powerBigInt(symbolWays, length) : 0n;
  if (symbolWays === 0) return lower === 0 ? powerBigInt(nonSymbolWays, length) : 0n;

  let term = binomialTerm(length, lower, nonSymbolWays, symbolWays);
  let total = 0n;
  for (let count = lower; count <= upper; count += 1) {
    total += term;
    if (count < upper) {
      term = term
        * BigInt(length - count)
        * BigInt(symbolWays)
        / (BigInt(count + 1) * BigInt(nonSymbolWays));
    }
  }
  return total;
}

function fixedSymbolNoAdjacentCount(
  length,
  nonSymbolWays,
  symbolWays,
  spaceWays,
  symbolCount,
  previousSpace = false,
) {
  if (symbolCount < 0 || symbolCount > length) return 0n;
  const maximumSpaces = Math.floor((length + (previousSpace ? 0 : 1)) / 2);
  let total = 0n;
  for (let spaceCount = 0; spaceCount <= maximumSpaces; spaceCount += 1) {
    const nonSpaceCount = length - spaceCount;
    if (symbolCount > nonSpaceCount) continue;
    const placementWays = cachedChooseBigInt(
      length - spaceCount + (previousSpace ? 0 : 1),
      spaceCount,
    );
    total += placementWays
      * powerBigInt(spaceWays, spaceCount)
      * binomialTerm(nonSpaceCount, symbolCount, nonSymbolWays, symbolWays);
  }
  return total;
}

function truncatedNoAdjacentCoefficients(
  length,
  nonSymbolWays,
  symbolWays,
  spaceWays,
  maximumDegree,
  trackNonSymbolPositions,
  previousSpace,
) {
  const width = maximumDegree + 1;
  let normal = new Array(width).fill(0n);
  let spaced = new Array(width).fill(0n);
  let nextNormal = new Array(width).fill(0n);
  let nextSpaced = new Array(width).fill(0n);
  if (previousSpace) spaced[0] = 1n;
  else normal[0] = 1n;
  const nonSymbol = BigInt(nonSymbolWays);
  const symbol = BigInt(symbolWays);
  const space = BigInt(spaceWays);

  for (let position = 0; position < length; position += 1) {
    nextNormal.fill(0n);
    nextSpaced.fill(0n);
    for (let degree = 0; degree < width; degree += 1) {
      const allPrevious = normal[degree] + spaced[degree];
      if (trackNonSymbolPositions) {
        nextNormal[degree] += symbol * allPrevious;
        if (degree + 1 < width) {
          nextNormal[degree + 1] += nonSymbol * allPrevious;
          nextSpaced[degree + 1] += space * normal[degree];
        }
      } else {
        nextNormal[degree] += nonSymbol * allPrevious;
        nextSpaced[degree] += space * normal[degree];
        if (degree + 1 < width) nextNormal[degree + 1] += symbol * allPrevious;
      }
    }
    [normal, nextNormal] = [nextNormal, normal];
    [spaced, nextSpaced] = [nextSpaced, spaced];
  }
  return normal.map((value, index) => value + spaced[index]);
}

function countNoAdjacentSymbolRange(
  length,
  nonSymbolWays,
  symbolWays,
  spaceWays,
  minimum,
  maximum,
  previousSpace = false,
) {
  const [lower, upper] = clampSymbolRange(length, minimum, maximum);
  if (lower > upper) return 0n;
  if (lower === 0 && upper === length) {
    return fullNoAdjacentCount(length, nonSymbolWays + symbolWays, spaceWays, previousSpace);
  }
  const cacheKey = `${length}:${nonSymbolWays}:${symbolWays}:${spaceWays}:${lower}:${upper}:${previousSpace ? 1 : 0}`;
  if (rangeCountCache.has(cacheKey)) return rangeCountCache.get(cacheKey);

  let result;
  if (spaceWays === 0) {
    result = sumBinomialTerms(length, nonSymbolWays, symbolWays, lower, upper);
  } else if (lower === upper) {
    result = fixedSymbolNoAdjacentCount(
      length,
      nonSymbolWays,
      symbolWays,
      spaceWays,
      lower,
      previousSpace,
    );
  } else {
    const directWidth = upper + 1;
    const tailWidth = lower + (length - upper);
    if (directWidth <= tailWidth) {
      const coefficients = truncatedNoAdjacentCoefficients(
        length,
        nonSymbolWays,
        symbolWays,
        spaceWays,
        upper,
        false,
        previousSpace,
      );
      result = coefficients.slice(lower, upper + 1).reduce((sum, value) => sum + value, 0n);
    } else {
      const total = fullNoAdjacentCount(length, nonSymbolWays + symbolWays, spaceWays, previousSpace);
      const lowerTail = lower === 0
        ? 0n
        : truncatedNoAdjacentCoefficients(
            length,
            nonSymbolWays,
            symbolWays,
            spaceWays,
            lower - 1,
            false,
            previousSpace,
          ).reduce((sum, value) => sum + value, 0n);
      const upperTailWidth = length - upper;
      const upperTail = upperTailWidth === 0
        ? 0n
        : truncatedNoAdjacentCoefficients(
            length,
            nonSymbolWays,
            symbolWays,
            spaceWays,
            upperTailWidth - 1,
            true,
            previousSpace,
          ).reduce((sum, value) => sum + value, 0n);
      result = total - lowerTail - upperTail;
    }
  }

  if (rangeCountCache.size > 10_000) rangeCountCache.clear();
  rangeCountCache.set(cacheKey, result);
  return result;
}

function endpointCharacterWays(startClass, endClass, poolSizes, allowRepeated) {
  const startSize = poolSizes[startClass];
  const endSize = poolSizes[endClass];
  if (allowRepeated) return BigInt(startSize) * BigInt(endSize);
  if (startClass === endClass) return BigInt(startSize) * BigInt(Math.max(0, endSize - 1));
  return BigInt(startSize) * BigInt(endSize);
}

function remainingPoolSizes(poolSizes, endpointClasses, allowRepeated) {
  const result = { ...poolSizes };
  if (!allowRepeated) {
    for (const name of endpointClasses) result[name] -= 1;
  }
  return result;
}

function countNonSymbolWays(positionCount, poolSizes, missingClasses, allowRepeated) {
  if (positionCount < 0) return 0n;
  const nonSymbolClasses = ['lower', 'upper', 'digit'];
  const missing = missingClasses.filter((name) => name !== 'symbol');
  let total = 0n;
  const subsetCount = 1 << missing.length;

  for (let mask = 0; mask < subsetCount; mask += 1) {
    const excluded = new Set();
    let bits = 0;
    for (let index = 0; index < missing.length; index += 1) {
      if (mask & (1 << index)) {
        excluded.add(missing[index]);
        bits += 1;
      }
    }
    const available = nonSymbolClasses.reduce(
      (sum, name) => sum + (excluded.has(name) ? 0 : Math.max(0, poolSizes[name])),
      0,
    );
    const ways = allowRepeated
      ? powerBigInt(available, positionCount)
      : fallingFactorialBigInt(available, positionCount);
    total += bits % 2 ? -ways : ways;
  }
  return total;
}

function interiorWays({ interiorLength, symbolCount, poolSizes, missingClasses, allowRepeated }) {
  if (symbolCount < 0 || symbolCount > interiorLength) return 0n;
  if (missingClasses.includes('symbol') && symbolCount === 0) return 0n;
  const symbolAvailable = Math.max(0, poolSizes.symbol);
  const symbolWays = allowRepeated
    ? powerBigInt(symbolAvailable, symbolCount)
    : fallingFactorialBigInt(symbolAvailable, symbolCount);
  if (symbolWays === 0n && symbolCount > 0) return 0n;
  const nonSymbolCount = interiorLength - symbolCount;
  const nonSymbolWays = countNonSymbolWays(nonSymbolCount, poolSizes, missingClasses, allowRepeated);
  if (nonSymbolWays <= 0n) return 0n;
  return cachedChooseBigInt(interiorLength, symbolCount) * symbolWays * nonSymbolWays;
}

function missingAfter(requiredClasses, endpointClasses) {
  return requiredClasses.filter((name) => !endpointClasses.includes(name));
}

function countRepeatedSequence({
  length,
  poolSizes,
  missingClasses,
  minimumSymbols,
  maximumSymbols,
  previousSpace = false,
}) {
  let total = 0n;
  const subsetCount = 1 << missingClasses.length;
  for (let mask = 0; mask < subsetCount; mask += 1) {
    const excluded = new Set();
    let excludedCount = 0;
    for (let index = 0; index < missingClasses.length; index += 1) {
      if (mask & (1 << index)) {
        excluded.add(missingClasses[index]);
        excludedCount += 1;
      }
    }
    const nonSymbolWays = ['lower', 'upper', 'digit'].reduce(
      (sum, name) => sum + (excluded.has(name) ? 0 : poolSizes[name]),
      0,
    );
    const symbolWays = excluded.has('symbol') ? 0 : poolSizes.symbol;
    const ways = countNoAdjacentSymbolRange(
      length,
      nonSymbolWays,
      symbolWays,
      poolSizes.space,
      minimumSymbols,
      maximumSymbols,
      previousSpace,
    );
    total += excludedCount % 2 ? -ways : ways;
  }
  return total;
}

function repeatedEndpointOptions(normalized, requiredClasses = normalized.requiredClasses) {
  if (normalized.length === 1) return [];
  const poolSizes = Object.fromEntries(ALL_CLASSES.map((name) => [name, normalized.pools[name].length]));
  const minimumSymbols = normalized.symbolCounts[0];
  const maximumSymbols = normalized.symbolCounts.at(-1);
  const options = [];
  for (const startClass of normalized.startClasses) {
    for (const endClass of normalized.endClasses) {
      const endpointClasses = [startClass, endClass];
      const endpointSymbolCount = endpointClasses.filter((name) => name === 'symbol').length;
      const completions = countRepeatedSequence({
        length: normalized.length - 2,
        poolSizes,
        missingClasses: missingAfter(requiredClasses, endpointClasses),
        minimumSymbols: minimumSymbols - endpointSymbolCount,
        maximumSymbols: maximumSymbols - endpointSymbolCount,
      });
      const endpointWays = BigInt(poolSizes[startClass]) * BigInt(poolSizes[endClass]);
      const weight = endpointWays * completions;
      if (weight > 0n) options.push({ startClass, endClass, weight });
    }
  }
  return options;
}

function countRepeatedOutputs(normalized) {
  if (normalized.length === 1) return sumStructuralOptions(normalized);
  return repeatedEndpointOptions(normalized).reduce((sum, option) => sum + option.weight, 0n);
}

function* iterateStructuralOptions(normalized) {
  const poolSizes = Object.fromEntries(ALL_CLASSES.map((name) => [name, normalized.pools[name].length]));
  const spaceMaximum = poolSizes.space
    ? Math.min(
        Math.floor((normalized.length - 1) / 2),
        normalized.allowRepeated ? normalized.length : poolSizes.space,
      )
    : 0;
  for (let spaceCount = 0; spaceCount <= spaceMaximum; spaceCount += 1) {
    const nonSpaceLength = normalized.length - spaceCount;
    const spacePlacementWays = cachedChooseBigInt(normalized.length - spaceCount - 1, spaceCount);
    const spaceCharacterWays = normalized.allowRepeated
      ? powerBigInt(poolSizes.space, spaceCount)
      : fallingFactorialBigInt(poolSizes.space, spaceCount);
    if (spacePlacementWays === 0n || spaceCharacterWays === 0n) continue;

    for (const totalSymbols of normalized.symbolCounts) {
      if (nonSpaceLength === 1) {
        for (const name of normalized.startClasses) {
          if (!normalized.endClasses.includes(name)) continue;
          if ((name === 'symbol' ? 1 : 0) !== totalSymbols) continue;
          if (normalized.requiredClasses.some((required) => required !== name)) continue;
          const weight = BigInt(poolSizes[name]) * spacePlacementWays * spaceCharacterWays;
          if (weight > 0n) yield { spaceCount, totalSymbols, startClass: name, endClass: name, weight, single: true };
        }
        continue;
      }

      for (const startClass of normalized.startClasses) {
        for (const endClass of normalized.endClasses) {
          const endpointClasses = [startClass, endClass];
          const endpointWays = endpointCharacterWays(startClass, endClass, poolSizes, normalized.allowRepeated);
          if (endpointWays === 0n) continue;
          const remainingSizes = remainingPoolSizes(poolSizes, endpointClasses, normalized.allowRepeated);
          const interiorSymbolCount = totalSymbols - endpointClasses.filter((name) => name === 'symbol').length;
          const completions = interiorWays({
            interiorLength: nonSpaceLength - 2,
            symbolCount: interiorSymbolCount,
            poolSizes: remainingSizes,
            missingClasses: missingAfter(normalized.requiredClasses, endpointClasses),
            allowRepeated: normalized.allowRepeated,
          });
          const weight = endpointWays * completions * spacePlacementWays * spaceCharacterWays;
          if (weight > 0n) {
            yield {
              spaceCount,
              totalSymbols,
              startClass,
              endClass,
              weight,
              single: false,
            };
          }
        }
      }
    }
  }
}

function sumStructuralOptions(normalized) {
  let total = 0n;
  for (const option of iterateStructuralOptions(normalized)) total += option.weight;
  return total;
}

function sampleStructuralOption(normalized, searchSpace, cryptoLike) {
  let rank = secureBigIntBelow(searchSpace, cryptoLike);
  for (const option of iterateStructuralOptions(normalized)) {
    if (rank < option.weight) return option;
    rank -= option.weight;
  }
  throw new Error('密码结构采样越界。');
}

export function countPasswordOutputs(config) {
  const normalized = normalizePasswordConfig(config);
  return normalized.allowRepeated
    ? countRepeatedOutputs(normalized)
    : sumStructuralOptions(normalized);
}

export function createPasswordModel(config) {
  const normalized = normalizePasswordConfig(config);
  const searchSpace = normalized.allowRepeated
    ? countRepeatedOutputs(normalized)
    : sumStructuralOptions(normalized);
  if (searchSpace <= 0n) throw new RangeError('当前约束下没有合法输出。');
  const minEntropyBits = log2BigInt(searchSpace);
  return deepFreeze({
    type: 'password',
    normalized,
    searchSpace,
    sourceEntropyBits: minEntropyBits,
    minEntropyBits,
    shannonEntropyBits: minEntropyBits,
    averageGuessBits: Math.max(0, minEntropyBits - 1),
    alphabet: ALL_CLASSES.flatMap((name) => normalized.pools[name]).join(''),
    poolSizes: Object.fromEntries(ALL_CLASSES.map((name) => [name, normalized.pools[name].length])),
    encoding: 'characters',
    standard: 'uniform-constrained-password-v2',
  });
}

function sampleCombination(size, count, cryptoLike) {
  if (count === 0) return [];
  let rank = secureBigIntBelow(cachedChooseBigInt(size, count), cryptoLike);
  const selected = [];
  let needed = count;
  for (let index = 0; index < size && needed > 0; index += 1) {
    const remaining = size - index - 1;
    const includeWays = cachedChooseBigInt(remaining, needed - 1);
    if (rank < includeWays) {
      selected.push(index);
      needed -= 1;
    } else {
      rank -= includeWays;
    }
  }
  return selected;
}

function drawCharacter(pool, allowRepeated, cryptoLike) {
  if (!pool.length) throw new RangeError('字符池已耗尽。');
  const index = secureInt(pool.length, cryptoLike);
  const [character] = allowRepeated ? [pool[index]] : pool.splice(index, 1);
  return character;
}

function sampleRequiredNonSymbols(positionCount, pools, missingClasses, allowRepeated, cryptoLike) {
  const result = [];
  let missing = [...missingClasses].filter((name) => name !== 'symbol');
  const classNames = ['lower', 'upper', 'digit'];

  for (let position = 0; position < positionCount; position += 1) {
    const remaining = positionCount - position - 1;
    const candidates = [];
    const weights = [];
    for (const name of classNames) {
      const available = pools[name].length;
      if (!available) continue;
      const sizesAfter = Object.fromEntries(ALL_CLASSES.map((className) => [className, pools[className].length]));
      if (!allowRepeated) sizesAfter[name] -= 1;
      const missingAfterChoice = missing.filter((required) => required !== name);
      const suffixWays = countNonSymbolWays(remaining, sizesAfter, missingAfterChoice, allowRepeated);
      const weight = BigInt(available) * suffixWays;
      if (weight > 0n) {
        candidates.push(name);
        weights.push(weight);
      }
    }
    const name = weightedBigIntChoice(candidates, weights, cryptoLike);
    result.push(drawCharacter(pools[name], allowRepeated, cryptoLike));
    missing = missing.filter((required) => required !== name);
  }
  return result;
}

function sampleNonSpaceSequence(option, normalized, cryptoLike) {
  const pools = Object.fromEntries(ALL_CLASSES.map((name) => [name, [...normalized.pools[name]]]));
  if (option.single) return [drawCharacter(pools[option.startClass], normalized.allowRepeated, cryptoLike)];

  const start = drawCharacter(pools[option.startClass], normalized.allowRepeated, cryptoLike);
  const end = drawCharacter(pools[option.endClass], normalized.allowRepeated, cryptoLike);
  const interiorLength = normalized.length - option.spaceCount - 2;
  const endpointClasses = [option.startClass, option.endClass];
  const interiorSymbolCount = option.totalSymbols - endpointClasses.filter((name) => name === 'symbol').length;
  const symbolPositions = new Set(sampleCombination(interiorLength, interiorSymbolCount, cryptoLike));
  const missing = missingAfter(normalized.requiredClasses, endpointClasses);
  const nonSymbolCharacters = sampleRequiredNonSymbols(
    interiorLength - interiorSymbolCount,
    pools,
    missing,
    normalized.allowRepeated,
    cryptoLike,
  );
  let nonSymbolIndex = 0;
  const interior = [];
  for (let index = 0; index < interiorLength; index += 1) {
    interior.push(symbolPositions.has(index)
      ? drawCharacter(pools.symbol, normalized.allowRepeated, cryptoLike)
      : nonSymbolCharacters[nonSymbolIndex++]);
  }
  return [start, ...interior, end];
}

function insertSpaces(nonSpace, spaceCount, normalized, cryptoLike) {
  if (!spaceCount) return nonSpace.join('');
  const internalSlotCount = normalized.length - 2;
  const compressedSize = internalSlotCount - spaceCount + 1;
  const compressed = sampleCombination(compressedSize, spaceCount, cryptoLike);
  const positions = new Set(compressed.map((value, index) => value + index + 1));
  const spacePool = [...normalized.pools.space];
  let nonSpaceIndex = 0;
  const output = [];
  for (let index = 0; index < normalized.length; index += 1) {
    output.push(positions.has(index)
      ? drawCharacter(spacePool, normalized.allowRepeated, cryptoLike)
      : nonSpace[nonSpaceIndex++]);
  }
  return output.join('');
}

function hasFullSymbolRange(normalized) {
  return normalized.symbolCounts.length === normalized.length + 1
    && normalized.symbolCounts[0] === 0
    && normalized.symbolCounts.at(-1) === normalized.length;
}

function sampleConditionedFullRangePassword(normalized, cryptoLike) {
  if (normalized.length === 1) {
    const values = normalized.startClasses.filter((name) => normalized.endClasses.includes(name)
      && normalized.requiredClasses.every((required) => required === name));
    const weights = values.map((name) => BigInt(normalized.pools[name].length));
    const className = weightedBigIntChoice(values, weights, cryptoLike);
    return drawCharacter([...normalized.pools[className]], true, cryptoLike);
  }

  const endpointOptions = repeatedEndpointOptions(normalized);
  const option = weightedBigIntChoice(
    endpointOptions,
    endpointOptions.map((entry) => entry.weight),
    cryptoLike,
  );
  const pools = Object.fromEntries(ALL_CLASSES.map((name) => [name, [...normalized.pools[name]]]));
  const poolSizes = Object.fromEntries(ALL_CLASSES.map((name) => [name, pools[name].length]));
  const start = drawCharacter(pools[option.startClass], true, cryptoLike);
  const end = drawCharacter(pools[option.endClass], true, cryptoLike);
  let missing = missingAfter(normalized.requiredClasses, [option.startClass, option.endClass]);
  let previousSpace = false;
  const interior = [];
  const interiorLength = normalized.length - 2;

  for (let position = 0; position < interiorLength; position += 1) {
    const remaining = interiorLength - position - 1;
    const candidates = [];
    const weights = [];
    for (const name of ALL_CLASSES) {
      const available = poolSizes[name];
      if (!available || (name === 'space' && previousSpace)) continue;
      const missingAfterChoice = name === 'space'
        ? missing
        : missing.filter((required) => required !== name);
      const suffixWays = countRepeatedSequence({
        length: remaining,
        poolSizes,
        missingClasses: missingAfterChoice,
        minimumSymbols: 0,
        maximumSymbols: remaining,
        previousSpace: name === 'space',
      });
      const weight = BigInt(available) * suffixWays;
      if (weight > 0n) {
        candidates.push(name);
        weights.push(weight);
      }
    }
    const name = weightedBigIntChoice(candidates, weights, cryptoLike);
    interior.push(drawCharacter(pools[name], true, cryptoLike));
    if (name !== 'space') missing = missing.filter((required) => required !== name);
    previousSpace = name === 'space';
  }

  const value = [start, ...interior, end].join('');
  return value;
}

function buildUnrestrictedFullRangeCounts(nonSpaceWays, spaceWays, length) {
  const counts = [1n];
  if (length === 0) return counts;
  const nonSpace = BigInt(nonSpaceWays);
  const spacedPair = nonSpace * BigInt(spaceWays);
  counts[1] = BigInt(nonSpaceWays + spaceWays);
  for (let index = 2; index <= length; index += 1) {
    counts[index] = nonSpace * counts[index - 1] + spacedPair * counts[index - 2];
  }
  return counts;
}

function sampleUnrestrictedFullRangeCandidate(normalized, endpointOptions, cryptoLike) {
  if (normalized.length === 1) {
    const className = weightedBigIntChoice(
      normalized.startClasses.filter((name) => normalized.endClasses.includes(name)),
      normalized.startClasses
        .filter((name) => normalized.endClasses.includes(name))
        .map((name) => BigInt(normalized.pools[name].length)),
      cryptoLike,
    );
    return drawCharacter([...normalized.pools[className]], true, cryptoLike);
  }

  const option = weightedBigIntChoice(
    endpointOptions,
    endpointOptions.map((entry) => entry.weight),
    cryptoLike,
  );
  const pools = Object.fromEntries(ALL_CLASSES.map((name) => [name, [...normalized.pools[name]]]));
  const poolSizes = Object.fromEntries(ALL_CLASSES.map((name) => [name, pools[name].length]));
  const nonSpaceWays = NON_SPACE_CLASSES.reduce((sum, name) => sum + poolSizes[name], 0);
  const interiorLength = normalized.length - 2;
  const freeCounts = buildUnrestrictedFullRangeCounts(
    nonSpaceWays,
    poolSizes.space,
    interiorLength,
  );
  const start = drawCharacter(pools[option.startClass], true, cryptoLike);
  const end = drawCharacter(pools[option.endClass], true, cryptoLike);
  const interior = [];
  let previousSpace = false;

  for (let position = 0; position < interiorLength; position += 1) {
    const remaining = interiorLength - position - 1;
    const candidates = [];
    const weights = [];
    for (const name of ALL_CLASSES) {
      const available = poolSizes[name];
      if (!available || (name === 'space' && previousSpace)) continue;
      const suffixWays = name === 'space'
        ? (remaining === 0 ? 1n : BigInt(nonSpaceWays) * freeCounts[remaining - 1])
        : freeCounts[remaining];
      const weight = BigInt(available) * suffixWays;
      if (weight > 0n) {
        candidates.push(name);
        weights.push(weight);
      }
    }
    const name = weightedBigIntChoice(candidates, weights, cryptoLike);
    interior.push(drawCharacter(pools[name], true, cryptoLike));
    previousSpace = name === 'space';
  }

  return [start, ...interior, end].join('');
}

function sampleRepeatedFullRangePassword(normalized, searchSpace, cryptoLike) {
  const unrestrictedOptions = repeatedEndpointOptions(normalized, []);
  const unrestrictedSpace = normalized.length === 1
    ? unrestrictedOptions.reduce((sum, option) => sum + option.weight, 0n)
      || normalized.startClasses
        .filter((name) => normalized.endClasses.includes(name))
        .reduce((sum, name) => sum + BigInt(normalized.pools[name].length), 0n)
    : unrestrictedOptions.reduce((sum, option) => sum + option.weight, 0n);

  if (unrestrictedSpace > 0n && searchSpace * 4n >= unrestrictedSpace) {
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const value = sampleUnrestrictedFullRangeCandidate(normalized, unrestrictedOptions, cryptoLike);
      const classes = new Set([...value].map((character) => (
        ALL_CLASSES.find((name) => normalized.pools[name].includes(character))
      )));
      if (normalized.requiredClasses.every((name) => classes.has(name))) return value;
    }
  }
  return sampleConditionedFullRangePassword(normalized, cryptoLike);
}

export function generatePassword(config, cryptoLike = globalThis.crypto, now = Date.now) {
  const model = createPasswordModel(config);
  const normalized = model.normalized;
  let value;
  if (normalized.allowRepeated && hasFullSymbolRange(normalized)) {
    value = sampleRepeatedFullRangePassword(normalized, model.searchSpace, cryptoLike);
  } else {
    const option = sampleStructuralOption(normalized, model.searchSpace, cryptoLike);
    const nonSpace = sampleNonSpaceSequence(option, normalized, cryptoLike);
    value = insertSpaces(nonSpace, option.spaceCount, normalized, cryptoLike);
  }
  const createdAt = Number(now());
  return createGenerationResult({
    id: `v2-password-${createdAt}-${++resultSequence}`,
    type: 'password',
    schemeId: 'uniform-constrained-password-v2',
    value,
    configSnapshot: normalized,
    generationModel: model,
    createdAt,
  });
}

export const PASSWORD_CLASS_BITS = CLASS_BIT;
