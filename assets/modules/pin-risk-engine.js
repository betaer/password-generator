const FALLBACK_WEAK_PINS = new Set([
  '0000', '1111', '1234', '1212', '7777', '1004', '2000', '4444', '2222', '6969',
  '9999', '3333', '5555', '6666', '1122', '1313', '8888', '4321', '2001', '1010',
  '123456', '111111', '000000', '121212', '654321', '666666', '112233', '123123',
]);

function decodeTypedArray(base64, Type) {
  const bytes = typeof Buffer !== 'undefined'
    ? Uint8Array.from(Buffer.from(base64, 'base64'))
    : Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const aligned = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Type(aligned);
}

export function parsePinRiskDatabasePayload(payload) {
  if (!payload || payload.encoding !== 'little-endian-typed-array-base64') {
    throw new TypeError('PIN 风险库格式无效。');
  }
  const fourDigitRanks = decodeTypedArray(payload.fourDigitRanks, Uint16Array);
  const sixDigitValues = decodeTypedArray(payload.sixDigitValues, Uint32Array);
  if (fourDigitRanks.length !== payload.metadata?.fourDigitCount) {
    throw new RangeError('4 位 PIN 风险库数量不匹配。');
  }
  if (sixDigitValues.length !== payload.metadata?.sixDigitCount) {
    throw new RangeError('6 位 PIN 风险库数量不匹配。');
  }
  const sixDigitRanks = new Map();
  sixDigitValues.forEach((value, index) => sixDigitRanks.set(String(value).padStart(6, '0'), index + 1));
  return Object.freeze({
    version: payload.version,
    metadata: Object.freeze({ ...payload.metadata }),
    fourDigitRanks,
    sixDigitRanks,
  });
}

export async function loadPinRiskDatabase(url = './assets/data/pin-risk.v1.json', fetchImpl = globalThis.fetch?.bind(globalThis)) {
  if (typeof fetchImpl !== 'function') throw new Error('当前环境无法加载 PIN 风险库。');
  const response = await fetchImpl(url, { credentials: 'same-origin', cache: 'force-cache' });
  if (!response?.ok) throw new Error(`PIN 风险库加载失败（HTTP ${response?.status || 0}）。`);
  return parsePinRiskDatabasePayload(await response.json());
}

function isDatePattern(pin) {
  if (pin.length !== 6) return false;
  const candidates = [
    [pin.slice(0, 2), pin.slice(2, 4)],
    [pin.slice(2, 4), pin.slice(4, 6)],
  ];
  return candidates.some(([monthText, dayText]) => {
    const month = Number(monthText);
    const day = Number(dayText);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31;
  });
}

function isContinuous(pin) {
  const digits = [...pin].map(Number);
  const direction = digits[1] - digits[0];
  if (![-1, 1].includes(direction)) return false;
  return digits.slice(1).every((digit, index) => digit - digits[index] === direction);
}

function hasShortCycle(pin) {
  for (let width = 1; width <= Math.floor(pin.length / 2); width += 1) {
    if (pin.length % width !== 0) continue;
    const unit = pin.slice(0, width);
    if (unit.repeat(pin.length / width) === pin && width < pin.length) return true;
  }
  return false;
}

function isKeypadPath(pin) {
  const paths = [
    '1234567890', '0987654321', '1472580369', '9630852741', '159', '951', '357', '753',
    '2580', '0852', '1470', '0741', '3690', '0963',
  ];
  return paths.some((path) => path.includes(pin));
}

export function detectPinPatterns(pin) {
  if (!/^\d{4}$|^\d{6}$/.test(String(pin ?? ''))) return [];
  const value = String(pin);
  const patterns = [];
  if (/^(\d)\1+$/.test(value)) patterns.push('全部重复');
  if (isContinuous(value)) patterns.push('连续数字');
  if (hasShortCycle(value) && !patterns.includes('全部重复')) patterns.push('短周期循环');
  if (isDatePattern(value)) patterns.push('日期样式');
  if (isKeypadPath(value)) patterns.push('键盘路径');
  return patterns;
}

export function inspectPin(pin, database = null) {
  const value = String(pin ?? '');
  if (!/^\d{4}$|^\d{6}$/.test(value)) {
    return Object.freeze({ valid: false, known: false, rank: null, patterns: [], blocked: false });
  }
  let rank = null;
  if (database) {
    rank = value.length === 4
      ? Number(database.fourDigitRanks[Number(value)] || 0) || null
      : database.sixDigitRanks.get(value) || null;
  }
  const patterns = detectPinPatterns(value);
  const rankThreshold = value.length === 4
    ? database?.metadata?.fourDigitBlockRank ?? 500
    : database?.metadata?.sixDigitBlockRank ?? 1000;
  const blocked = FALLBACK_WEAK_PINS.has(value) || patterns.length > 0 || (rank !== null && rank <= rankThreshold);
  return Object.freeze({
    valid: true,
    known: rank !== null || FALLBACK_WEAK_PINS.has(value),
    rank,
    rankThreshold,
    patterns: Object.freeze(patterns),
    blocked,
  });
}

export function shouldBlockWeakPin(pin, database = null) {
  return inspectPin(pin, database).blocked;
}
