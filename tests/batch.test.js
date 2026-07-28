import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindTranslationArtifact,
  bindVerdictArtifact,
  createBatch,
  validateTranslationArtifact,
  validateVerdictArtifact,
} from '../dist/core/batch.js';

const work = [
  {
    key: 'hero.title',
    locale: 'de-DE',
    source: 'Welcome, {name}',
    kind: 'heading',
    file: 'app/page.tsx',
    placeholders: ['{name}'],
    reason: 'new',
  },
  {
    key: 'hero.cta',
    locale: 'de-DE',
    source: 'Start free',
    kind: 'cta',
    file: 'app/page.tsx',
    placeholders: [],
    reason: 'rework',
    attempt: 2,
  },
];

test('batch integrity binds every unit to a stable source and context hash', () => {
  const batch = createBatch(work, {
    id: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-07-28T00:00:00.000Z',
    contextHashes: new Map([['hero.title::de-DE', 'context-a']]),
  });

  assert.equal(batch.version, 1);
  assert.equal(batch.units.length, 2);
  assert.match(batch.units[0].sourceHash, /^[a-f0-9]{16}$/);
  assert.equal(batch.units[0].contextHash, 'context-a');
  assert.equal(batch.units[1].attempt, 2);
});

test('batch integrity rejects missing, duplicate, extra, and stale translations', () => {
  const batch = createBatch(work, { id: 'batch-1' });
  const complete = bindTranslationArtifact(batch, [
    { key: 'hero.title', locale: 'de-DE', value: 'Willkommen, {name}' },
    { key: 'hero.cta', locale: 'de-DE', value: 'Kostenlos starten' },
  ], 'test');

  assert.deepEqual(validateTranslationArtifact(batch, complete), complete);

  assert.throws(
    () => validateTranslationArtifact(batch, { ...complete, translations: complete.translations.slice(0, 1) }),
    /missing.*hero\.cta::de-DE/i
  );
  assert.throws(
    () => validateTranslationArtifact(batch, {
      ...complete,
      translations: [...complete.translations, complete.translations[0]],
    }),
    /duplicate.*hero\.title::de-DE/i
  );
  assert.throws(
    () => validateTranslationArtifact(batch, {
      ...complete,
      translations: [...complete.translations, {
        ...complete.translations[0],
        key: 'unknown',
        candidateHash: 'wrong',
      }],
    }),
    /extra.*unknown::de-DE/i
  );
  assert.throws(
    () => validateTranslationArtifact(batch, {
      ...complete,
      translations: complete.translations.map((item, index) =>
        index ? item : { ...item, sourceHash: 'stale-source' }
      ),
    }),
    /source hash.*hero\.title::de-DE/i
  );
});

test('batch integrity rejects verdicts for another candidate or incomplete verdict sets', () => {
  const batch = createBatch(work, { id: 'batch-2' });
  const translations = bindTranslationArtifact(batch, [
    { key: 'hero.title', locale: 'de-DE', value: 'Willkommen, {name}' },
    { key: 'hero.cta', locale: 'de-DE', value: 'Kostenlos starten' },
  ], 'test');
  const verdicts = bindVerdictArtifact(batch, translations, [
    { key: 'hero.title', locale: 'de-DE', ok: true },
    { key: 'hero.cta', locale: 'de-DE', ok: false, reason: 'too formal' },
  ], 'judge');

  assert.deepEqual(validateVerdictArtifact(batch, translations, verdicts), verdicts);
  assert.throws(
    () => validateVerdictArtifact(batch, translations, {
      ...verdicts,
      verdicts: verdicts.verdicts.slice(0, 1),
    }),
    /missing.*hero\.cta::de-DE/i
  );
  assert.throws(
    () => validateVerdictArtifact(batch, translations, {
      ...verdicts,
      verdicts: verdicts.verdicts.map((item, index) =>
        index ? item : { ...item, candidateHash: 'candidate-from-another-run' }
      ),
    }),
    /candidate hash.*hero\.title::de-DE/i
  );
  assert.throws(
    () => validateVerdictArtifact(batch, translations, {
      ...verdicts,
      batchId: 'old-batch',
    }),
    /batch id/i
  );
});
