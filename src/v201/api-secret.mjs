import { formatExistingBytes } from '../v2/byte-secret-models.mjs';
import { secureRandomBytes } from '../v2/random-core.mjs';
import { createPowerOfTwoSearchSpace } from './probability-contract.mjs';
import { createGenerationResult } from './result-model.mjs';

const TEMPLATES = new Set(['generic', 'synthetic-demo']);
const ENCODINGS = new Set(['hex', 'base64', 'base64url', 'base64url-nopad']);

function textField(value, name, maxLength) {
  const normalized = value ?? '';
  if (typeof normalized !== 'string') throw new TypeError(`${name} must be a string`);
  if (normalized.length > maxLength) throw new RangeError(`${name} must not exceed ${maxLength} characters`);
  if (!/^[\x20-\x7e]*$/u.test(normalized)) throw new RangeError(`${name} must use printable ASCII`);
  return normalized;
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('config must be an object');
  const template = config.template ?? 'generic';
  if (!TEMPLATES.has(template)) throw new RangeError(`unsupported API Secret template: ${String(template)}`);
  const byteLength = config.byteLength ?? 32;
  const encoding = config.encoding ?? 'base64url-nopad';
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 4096) throw new RangeError('byteLength must be between 1 and 4096');
  if (!ENCODINGS.has(encoding)) throw new RangeError(`unsupported encoding: ${String(encoding)}`);
  if (template === 'synthetic-demo') {
    return Object.freeze({
      template,
      byteLength,
      encoding,
      prefix: 'demo_test_v1_',
      environment: '',
      version: '',
      syntheticAppearance: true,
      warning: '这是无厂商含义的合成示例格式，不代表任何真实服务凭据。',
    });
  }
  return Object.freeze({
    template,
    byteLength,
    encoding,
    prefix: textField(config.prefix, 'prefix', 64),
    environment: textField(config.environment, 'environment', 32),
    version: textField(config.version, 'version', 32),
    syntheticAppearance: false,
    warning: '',
  });
}

function composePrefix(config) {
  const suffixFields = [config.environment, config.version].filter(Boolean);
  return suffixFields.length ? `${config.prefix}${suffixFields.join('_')}_` : config.prefix;
}

export function generateApiSecret(config = {}, cryptoLike = globalThis.crypto) {
  const normalized = normalizeConfig(config);
  const bytes = secureRandomBytes(normalized.byteLength, cryptoLike);
  const prefix = composePrefix(normalized);
  const bits = normalized.byteLength * 8;
  return createGenerationResult({
    type: 'api-secret',
    schemeId: normalized.template === 'generic' ? 'generic-api-secret-v201' : 'synthetic-demo-api-secret-v201',
    value: prefix + formatExistingBytes(bytes, normalized.encoding),
    bytes,
    configSnapshot: { ...normalized, prefix },
    generationModel: {
      searchSpace: createPowerOfTwoSearchSpace(bits),
      generatorMinEntropyBits: bits,
      generatorShannonEntropyBits: bits,
      nominalCsprngOutputBits: bits,
      randomSourceBytesRequested: normalized.byteLength,
      randomSourceConsumptionModel: 'fixed-byte-request',
      presentationProfile: 'api-secret',
      prefix,
      encoding: normalized.encoding,
      standard: normalized.syntheticAppearance ? 'Synthetic demo secret' : 'Generic Web Crypto API secret',
    },
  });
}

