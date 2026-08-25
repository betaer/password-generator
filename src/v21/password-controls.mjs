function freezeRecipe(recipe) {
  return Object.freeze({
    ...recipe,
    symbolRatioRange: Object.freeze([...recipe.symbolRatioRange]),
  });
}

export const DEFAULT_PASSWORD_SYMBOL_POOL = '!@#$%^&*()-_=+[]{};:,.?';

export const PASSWORD_COMPLEXITY_PRESETS = Object.freeze([
  Object.freeze({ level: 'L1', label: '瞬间破解', tone: '#c62828', recipe: freezeRecipe({ length: 4, lowercase: false, uppercase: false, digits: true, symbols: false, symbolRatioRange: [0, 0] }) }),
  Object.freeze({ level: 'L2', label: '极易破解', tone: '#c2410c', recipe: freezeRecipe({ length: 6, lowercase: true, uppercase: false, digits: false, symbols: false, symbolRatioRange: [0, 0] }) }),
  Object.freeze({ level: 'L3', label: '容易破解', tone: '#b35c00', recipe: freezeRecipe({ length: 8, lowercase: true, uppercase: false, digits: false, symbols: false, symbolRatioRange: [0, 0] }) }),
  Object.freeze({ level: 'L4', label: '有一定风险', tone: '#876400', recipe: freezeRecipe({ length: 8, lowercase: true, uppercase: true, digits: true, symbols: false, symbolRatioRange: [0, 0] }) }),
  Object.freeze({ level: 'L5', label: '较难破解', tone: '#4d7c0f', recipe: freezeRecipe({ length: 10, lowercase: true, uppercase: true, digits: true, symbols: false, symbolRatioRange: [0, 0] }) }),
  Object.freeze({ level: 'L6', label: '很难破解', tone: '#15803d', recipe: freezeRecipe({ length: 12, lowercase: true, uppercase: true, digits: true, symbols: true, symbolRatioRange: [10, 20] }) }),
  Object.freeze({ level: 'L7', label: '极难破解', tone: '#0f766e', recipe: freezeRecipe({ length: 16, lowercase: true, uppercase: true, digits: true, symbols: true, symbolRatioRange: [10, 25] }) }),
  Object.freeze({ level: 'L8', label: '几乎无法破解', tone: '#1d4ed8', recipe: freezeRecipe({ length: 20, lowercase: true, uppercase: true, digits: true, symbols: true, symbolRatioRange: [10, 35] }) }),
]);

export const PASSWORD_LENGTH_PRESETS = Object.freeze([4, 6, 8, 12, 16, 20, 24, 32, 64, 128, 256]);
export const PASSWORD_QUANTITY_PRESETS = Object.freeze([1, 3, 5, 10, 25, 50, 100]);

export function applyPasswordComplexityPreset(currentConfig, level) {
  if (!currentConfig || typeof currentConfig !== 'object' || Array.isArray(currentConfig)) {
    throw new TypeError('currentConfig must be an object');
  }
  const preset = PASSWORD_COMPLEXITY_PRESETS.find((candidate) => candidate.level === level);
  if (!preset) throw new RangeError(`unsupported complexity level: ${String(level)}`);
  const next = {
    ...currentConfig,
    ...preset.recipe,
    symbolPool: DEFAULT_PASSWORD_SYMBOL_POOL,
    allowSpace: false,
    requireEach: true,
    allowRepeated: true,
    startsWith: 'any',
    endsWith: 'any',
    symbolRatioRange: Object.freeze([...preset.recipe.symbolRatioRange]),
  };
  return Object.freeze(next);
}
