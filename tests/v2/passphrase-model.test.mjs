import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import {
  createPassphraseModel,
  generatePassphrase,
  getCompatiblePassphraseWords,
} from '../../src/v2/passphrase-model.mjs';

const words = ['alpha', 'bravo', 'cider', 'delta'];
const zeroCrypto = {
  getRandomValues(target) {
    target.fill(0);
    return target;
  },
};

test('word draws, random uppercase position, and every random digit gap share one exact model', () => {
  const model = createPassphraseModel({
    wordCount: 3,
    words,
    capitalization: 'random-uppercase',
    separator: 'random-digit',
  });

  const expected = 4n ** 3n * 3n * 10n ** 2n;
  assert.equal(model.searchSpace, expected);
  assert.equal(model.wordPoolSize, 4);
  assert.equal(model.capitalizationChoices, 3);
  assert.equal(model.separatorChoicesPerGap, 10);
  assert.equal(model.minEntropyBits, Math.log2(Number(expected)));
  assert.equal(model.shannonEntropyBits, model.minEntropyBits);
  assert.equal(model.sourceEntropyBits, model.minEntropyBits);
});

test('fixed separators add no entropy and render their exact delimiter', () => {
  const cases = [
    ['hyphen', '-'],
    ['underscore', '_'],
    ['period', '.'],
    ['space', ' '],
  ];

  for (const [separator, expectedDelimiter] of cases) {
    const config = {
      wordCount: 2,
      words,
      capitalization: 'lowercase',
      separator,
    };
    const model = createPassphraseModel(config);
    const result = generatePassphrase(config, zeroCrypto);

    assert.equal(model.searchSpace, 4n ** 2n);
    assert.equal(model.separatorChoicesPerGap, 1);
    assert.equal(result.value, `alpha${expectedDelimiter}alpha`);
  }
});

test('deterministic capitalization modes do not claim extra entropy', () => {
  const cases = [
    ['lowercase', 'alpha-alpha'],
    ['first-word', 'Alpha-alpha'],
    ['every-word', 'Alpha-Alpha'],
  ];

  for (const [capitalization, expectedValue] of cases) {
    const config = { wordCount: 2, words, capitalization, separator: 'hyphen' };
    const model = createPassphraseModel(config);
    const result = generatePassphrase(config, zeroCrypto);

    assert.equal(model.capitalizationChoices, 1);
    assert.equal(model.searchSpace, 4n ** 2n);
    assert.equal(result.value, expectedValue);
  }
});

test('random uppercase uniformly chooses one word position and records that factor', () => {
  const config = {
    wordCount: 3,
    words,
    capitalization: 'random-uppercase',
    separator: 'hyphen',
  };
  const model = createPassphraseModel(config);
  const result = generatePassphrase(config, zeroCrypto);

  assert.equal(model.searchSpace, 4n ** 3n * 3n);
  assert.equal(result.value, 'ALPHA-alpha-alpha');
  assert.equal(result.generationModel.capitalizationChoices, 3);
});

test('random symbols use the actual unique symbol count independently at every gap', () => {
  const config = {
    wordCount: 3,
    words,
    capitalization: 'lowercase',
    separator: 'random-symbol',
    separatorSymbols: '!@!',
  };
  const model = createPassphraseModel(config);
  const result = generatePassphrase(config, zeroCrypto);

  assert.equal(model.separatorChoicesPerGap, 2);
  assert.deepEqual(model.normalized.separatorChoices, ['!', '@']);
  assert.equal(model.searchSpace, 4n ** 3n * 2n ** 2n);
  assert.equal(result.value, 'alpha!alpha!alpha');
});

test('one-word phrases have no separator entropy', () => {
  const digit = createPassphraseModel({
    wordCount: 1,
    words,
    capitalization: 'lowercase',
    separator: 'random-digit',
  });
  const symbol = createPassphraseModel({
    wordCount: 1,
    words,
    capitalization: 'lowercase',
    separator: 'random-symbol',
    separatorSymbols: '',
  });

  assert.equal(digit.searchSpace, 4n);
  assert.equal(symbol.searchSpace, 4n);
  assert.equal(digit.separatorGapCount, 0);
  assert.equal(symbol.separatorGapCount, 0);
});

test('generated result retains the configured generation model instead of re-reading its string', () => {
  const config = {
    wordCount: 2,
    words,
    wordPackId: 'test-pack',
    capitalization: 'random-uppercase',
    separator: 'random-digit',
  };
  const before = createPassphraseModel(config);
  const result = generatePassphrase(config, zeroCrypto);

  assert.equal(result.type, 'passphrase');
  assert.equal(result.schemeId, 'passphrase');
  assert.equal(result.generationModel.searchSpace, before.searchSpace);
  assert.equal(result.generationModel.minEntropyBits, before.minEntropyBits);
  assert.equal(result.generationModel.separatorChoicesPerGap, before.separatorChoicesPerGap);
  assert.equal(result.configSnapshot.wordPackId, 'test-pack');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.generationModel));
  assert.ok(Object.isFrozen(result.configSnapshot));
});

test('duplicate words are rejected so independent draws stay uniform over distinct outputs', () => {
  assert.throws(
    () => createPassphraseModel({
      wordCount: 2,
      words: ['alpha', 'bravo', 'alpha'],
      capitalization: 'lowercase',
      separator: 'hyphen',
    }),
    /重复.*单词|单词.*重复/,
  );
});

test('words containing an active separator are rejected to keep output mapping injective', () => {
  assert.throws(
    () => createPassphraseModel({
      wordCount: 2,
      words: ['a', 'b-c', 'a-b', 'c'],
      wordPackId: 'collision-fixture',
      capitalization: 'lowercase',
      separator: 'hyphen',
    }),
    /分隔符.*单词/u,
  );
  assert.doesNotThrow(() => createPassphraseModel({
    wordCount: 1,
    words: ['single-word'],
    wordPackId: 'one-word-fixture',
    capitalization: 'lowercase',
    separator: 'hyphen',
  }));
});

test('capitalization transforms must remain injective over the configured word pool', () => {
  for (const capitalization of ['first-word', 'every-word']) {
    assert.throws(
      () => createPassphraseModel({
        wordCount: 1,
        words: ['i', 'ı'],
        wordPackId: 'unicode-case-collision',
        capitalization,
        separator: 'space',
      }),
      /大小写.*不同输出/u,
    );
  }
  assert.throws(
    () => createPassphraseModel({
      wordCount: 1,
      words: ['ß', 'ss'],
      wordPackId: 'unicode-uppercase-collision',
      capitalization: 'random-uppercase',
      separator: 'space',
    }),
    /大小写.*不同输出/u,
  );
});

test('separator safety is evaluated after capitalization transforms', () => {
  assert.throws(
    () => createPassphraseModel({
      wordCount: 3,
      words: ['a', 's', 'ß'],
      capitalization: 'every-word',
      separator: 'random-symbol',
      separatorSymbols: 'S',
    }),
    /分隔符.*单词/u,
  );
  assert.deepEqual(getCompatiblePassphraseWords({
    wordCount: 3,
    words: ['a', 's', 'ß'],
    capitalization: 'every-word',
    separator: 'random-symbol',
    separatorSymbols: 'S',
  }), ['a']);
});

test('UI compatibility filtering keeps only words with an injective rendered form', () => {
  const compatible = getCompatiblePassphraseWords({
    wordCount: 2,
    words: ['a', 'b-c', 'a-b', 'c'],
    capitalization: 'lowercase',
    separator: 'hyphen',
  });
  assert.deepEqual(compatible, ['a', 'c']);
  assert.ok(Object.isFrozen(compatible));
  const model = createPassphraseModel({
    wordCount: 2,
    words: compatible,
    sourceWordPoolSize: 4,
    capitalization: 'lowercase',
    separator: 'hyphen',
  });
  assert.equal(model.wordPoolSize, 2);
  assert.equal(model.sourceWordPoolSize, 4);
  assert.equal(model.excludedAmbiguousWordCount, 2);
  assert.equal(model.searchSpace, 4n);
});

test('every embedded word pack remains exactly modeled across all UI separator and casing modes', async () => {
  const source = await readFile(
    new URL('../../assets/js/embedded-word-packs.js', import.meta.url),
    'utf8',
  );
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'embedded-word-packs.js' });
  const packs = context.EmbeddedWordPacksV1?.packs;
  assert.ok(packs && typeof packs === 'object');

  const capitalizations = ['lowercase', 'first-word', 'every-word', 'random-uppercase'];
  const separators = [
    ['hyphen', ''],
    ['underscore', ''],
    ['period', ''],
    ['space', ''],
    ['random-digit', ''],
    ['random-symbol', '!@#$%&*+?'],
  ];

  for (const [packId, pack] of Object.entries(packs)) {
    const packWords = Array.from(pack.entries ?? pack);
    assert.ok(packWords.length > 0, `${packId} must contain words`);
    for (const capitalization of capitalizations) {
      for (const [separator, separatorSymbols] of separators) {
        const compatible = getCompatiblePassphraseWords({
          wordCount: 6,
          words: packWords,
          capitalization,
          separator,
          separatorSymbols,
        });
        const model = createPassphraseModel({
          wordCount: 6,
          words: compatible,
          sourceWordPoolSize: packWords.length,
          wordPackId: packId,
          capitalization,
          separator,
          separatorSymbols,
        });
        assert.equal(model.wordPoolSize, compatible.length);
        assert.equal(model.sourceWordPoolSize, packWords.length);
        assert.ok(model.searchSpace > 0n);
      }
    }
  }

  for (const packId of ['technology', 'network-security']) {
    const packWords = Array.from(packs[packId].entries ?? packs[packId]);
    const compatible = getCompatiblePassphraseWords({
      wordCount: 6,
      words: packWords,
      capitalization: 'lowercase',
      separator: 'hyphen',
    });
    assert.ok(compatible.length < packWords.length, `${packId} must filter hyphenated words`);
  }
});

test('invalid configuration fails explicitly', () => {
  const base = { wordCount: 2, words, capitalization: 'lowercase', separator: 'hyphen' };

  assert.throws(() => createPassphraseModel({ ...base, wordCount: 0 }), /wordCount/);
  assert.throws(() => createPassphraseModel({ ...base, words: [] }), /words/);
  assert.throws(() => createPassphraseModel({ ...base, capitalization: 'title-case' }), /capitalization/);
  assert.throws(() => createPassphraseModel({ ...base, separator: 'slash' }), /separator/);
  assert.throws(
    () => createPassphraseModel({ ...base, separator: 'random-symbol', separatorSymbols: '' }),
    /separatorSymbols/,
  );
});
