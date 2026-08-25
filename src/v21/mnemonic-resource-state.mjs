export function shouldCommitMnemonicResourceState({
  requestEpoch,
  latestRequestEpoch,
  activeMode,
  selectedLanguage,
  requestedLanguage,
}) {
  if (!Number.isSafeInteger(requestEpoch) || requestEpoch < 1) {
    throw new RangeError('requestEpoch must be a positive safe integer');
  }
  if (!Number.isSafeInteger(latestRequestEpoch) || latestRequestEpoch < 1) {
    throw new RangeError('latestRequestEpoch must be a positive safe integer');
  }
  if (typeof activeMode !== 'string' || activeMode.length === 0) {
    throw new TypeError('activeMode must be a non-empty string');
  }
  if (typeof requestedLanguage !== 'string' || requestedLanguage.length === 0) {
    throw new TypeError('requestedLanguage must be a non-empty string');
  }
  if (selectedLanguage !== null && selectedLanguage !== undefined && typeof selectedLanguage !== 'string') {
    throw new TypeError('selectedLanguage must be a string, null, or undefined');
  }
  if (requestEpoch !== latestRequestEpoch) return false;
  return activeMode !== 'mnemonic' || selectedLanguage === requestedLanguage;
}
