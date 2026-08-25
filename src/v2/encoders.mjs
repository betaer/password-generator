function assertBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytes must be a Uint8Array');
  }
  return bytes;
}

function bytesToBinary(bytes) {
  assertBytes(bytes);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return binary;
}

function binaryToBytes(binary) {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requireBase64Api(name) {
  const api = globalThis[name];
  if (typeof api !== 'function') {
    throw new Error(`${name} is unavailable in this runtime`);
  }
  return api;
}

export function encodeHex(bytes, uppercase = false) {
  assertBytes(bytes);
  if (typeof uppercase !== 'boolean') {
    throw new TypeError('uppercase must be a boolean');
  }
  let encoded = '';
  for (const byte of bytes) {
    encoded += byte.toString(16).padStart(2, '0');
  }
  return uppercase ? encoded.toUpperCase() : encoded;
}

export function decodeHex(value) {
  if (typeof value !== 'string') {
    throw new TypeError('hex value must be a string');
  }
  const normalized = value.startsWith('0x') || value.startsWith('0X')
    ? value.slice(2)
    : value;
  if (normalized.length % 2 !== 0) {
    throw new RangeError('hex value must contain a whole number of bytes');
  }
  if (!/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new TypeError('hex value contains non-hexadecimal characters');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function encodeBase64(bytes) {
  return requireBase64Api('btoa')(bytesToBinary(bytes));
}

export function encodeBase64Url(bytes, padding = true) {
  if (typeof padding !== 'boolean') {
    throw new TypeError('padding must be a boolean');
  }
  const encoded = encodeBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_');
  return padding ? encoded : encoded.replace(/=+$/u, '');
}

export function decodeBase64Url(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Base64URL value must be a string');
  }
  if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(value)) {
    throw new TypeError('Base64URL value contains invalid characters or padding');
  }

  const firstPadding = value.indexOf('=');
  const core = firstPadding === -1 ? value : value.slice(0, firstPadding);
  const providedPadding = firstPadding === -1 ? 0 : value.length - firstPadding;
  const remainder = core.length % 4;
  if (remainder === 1) {
    throw new RangeError('Base64URL value has an invalid length');
  }
  const requiredPadding = remainder === 0 ? 0 : 4 - remainder;
  if (providedPadding !== 0 && providedPadding !== requiredPadding) {
    throw new TypeError('Base64URL value has invalid padding');
  }

  const base64 = core
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(core.length + requiredPadding, '=');
  try {
    return binaryToBytes(requireBase64Api('atob')(base64));
  } catch (error) {
    throw new TypeError('Base64URL value is not decodable', { cause: error });
  }
}

