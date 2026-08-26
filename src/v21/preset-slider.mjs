function assertPresetValues(presetValues) {
  if (!Array.isArray(presetValues) || presetValues.length === 0) {
    throw new TypeError('presetValues must be a non-empty array');
  }
  if (new Set(presetValues).size !== presetValues.length) {
    throw new RangeError('presetValues must contain unique values');
  }
}

export function discreteSliderIndex(value, presetValues) {
  assertPresetValues(presetValues);
  const index = presetValues.indexOf(value);
  return index === -1 ? presetValues.length : index;
}

export function discreteSliderValue(index, presetValues, currentValue) {
  assertPresetValues(presetValues);
  if (!Number.isSafeInteger(index) || index < 0 || index > presetValues.length) {
    throw new RangeError('slider index is outside the discrete scale');
  }
  return index === presetValues.length ? currentValue : presetValues[index];
}
