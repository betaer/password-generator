import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldCommitMnemonicResourceState } from '../../src/v21/mnemonic-resource-state.mjs';

test('BIP39 英语在 Password 模式加载完成后仍应提交 ready 状态', () => {
  assert.equal(shouldCommitMnemonicResourceState({
    requestEpoch: 1,
    latestRequestEpoch: 1,
    activeMode: 'password',
    selectedLanguage: null,
    requestedLanguage: 'english',
  }), true);
});

test('BIP39 在助记词模式只允许当前选中的最新语言更新状态', () => {
  assert.equal(shouldCommitMnemonicResourceState({
    requestEpoch: 1,
    latestRequestEpoch: 2,
    activeMode: 'mnemonic',
    selectedLanguage: 'english',
    requestedLanguage: 'english',
  }), false);
  assert.equal(shouldCommitMnemonicResourceState({
    requestEpoch: 2,
    latestRequestEpoch: 2,
    activeMode: 'mnemonic',
    selectedLanguage: 'japanese',
    requestedLanguage: 'english',
  }), false);
  assert.equal(shouldCommitMnemonicResourceState({
    requestEpoch: 2,
    latestRequestEpoch: 2,
    activeMode: 'mnemonic',
    selectedLanguage: 'japanese',
    requestedLanguage: 'japanese',
  }), true);
});

test('BIP39 状态判定拒绝非法 epoch 与空语言', () => {
  for (const input of [
    { requestEpoch: 0, latestRequestEpoch: 0, activeMode: 'password', selectedLanguage: null, requestedLanguage: 'english' },
    { requestEpoch: 1, latestRequestEpoch: 1, activeMode: 'password', selectedLanguage: null, requestedLanguage: '' },
    { requestEpoch: 1, latestRequestEpoch: 1, activeMode: '', selectedLanguage: null, requestedLanguage: 'english' },
  ]) assert.throws(() => shouldCommitMnemonicResourceState(input));
});
