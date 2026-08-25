const MODES = new Set([
  'password', 'passphrase', 'pin', 'token', 'apiSecret',
  'uuid', 'hex', 'randomBytes', 'mnemonic',
]);

function cloneConfig(value, seen = new Map()) {
  if (value === null || ['string', 'boolean', 'undefined', 'bigint'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('generation config numbers must be finite');
    return value;
  }
  if (!value || typeof value !== 'object') throw new TypeError('generation config contains an unsupported value');
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new TypeError('generation config must not contain mutable binary values');
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('generation config must contain arrays and plain objects only');
  }
  if (seen.has(value)) return seen.get(value);
  const clone = Array.isArray(value) ? [] : Object.create(prototype);
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) clone[key] = cloneConfig(value[key], seen);
  return clone;
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
}

export function createGenerationJob({ id, mode, config, quantity }) {
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError('generation job id must be a positive safe integer');
  if (typeof mode !== 'string' || !MODES.has(mode)) throw new RangeError(`unsupported generation mode: ${String(mode)}`);
  if (!config || typeof config !== 'object' || Array.isArray(config) || ArrayBuffer.isView(config)) {
    throw new TypeError('generation config must be a plain object');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new RangeError('generation quantity must be between 1 and 100');
  }
  return freeze({ id, mode, config: cloneConfig(config), quantity });
}

export function createGenerationCoordinator() {
  let epoch = 0;
  let active = null;
  let cancelReason = '';
  const coordinator = {
    begin(mode, config, quantity) {
      epoch += 1;
      cancelReason = active ? 'superseded' : '';
      active = createGenerationJob({ id: epoch, mode, config, quantity });
      return active;
    },
    cancel(reason = 'cancelled') {
      const cancelled = active;
      epoch += 1;
      active = null;
      cancelReason = String(reason);
      return cancelled;
    },
    isCurrent: (job) => Boolean(active && job && active.id === job.id && epoch === job.id),
    get activeJob() { return active; },
    get cancelReason() { return cancelReason; },
    get epoch() { return epoch; },
  };
  return Object.freeze(coordinator);
}

