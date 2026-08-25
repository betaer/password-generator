function requireLimit(maxLength) {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
    throw new RangeError('maxLength must be a positive safe integer');
  }
}

export function normalizeOptionalPrintableAscii(value, label, maxLength) {
  requireLimit(maxLength);
  const normalized = value ?? '';
  if (typeof normalized !== 'string') throw new TypeError(`${label} 必须是字符串。`);
  if (normalized.length > maxLength) throw new RangeError(`${label} 最长 ${maxLength} 个字符。`);
  if (!/^[\x20-\x7e]*$/u.test(normalized)) {
    throw new RangeError(`${label} 仅支持 printable ASCII，避免控制字符、双向文本和 Unicode 规范化歧义。`);
  }
  return normalized;
}

export function normalizePrintableAscii(value, label, maxLength) {
  const normalized = normalizeOptionalPrintableAscii(value, label, maxLength);
  if (!normalized.length) throw new RangeError(`${label} 不能为空。`);
  return normalized;
}
