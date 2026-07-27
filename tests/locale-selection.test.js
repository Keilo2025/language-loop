import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLocaleSelection } from '../dist/core/locale-selection.js';

test('all selects every common locale and includes the source once', () => {
  const locales = resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'all' });
  assert.equal(locales[0], 'en-US');
  assert.equal(locales.filter((code) => code === 'en-US').length, 1);
  assert.ok(locales.length >= 80);
});

test('regions combine and deduplicate their locale choices', () => {
  const locales = resolveLocaleSelection({
    sourceLocale: 'en-US',
    mode: 'regions',
    regions: ['europe', 'americas'],
  });
  assert.equal(new Set(locales).size, locales.length);
  assert.ok(locales.includes('en-GB'));
  assert.ok(locales.includes('es-419'));
});

test('custom selection canonicalizes valid codes', () => {
  assert.deepEqual(
    resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'custom', codes: ['FR-ca', 'de-DE'] }),
    ['en-US', 'fr-CA', 'de-DE'],
  );
});

test('unknown and empty regions are rejected with accepted values', () => {
  assert.throws(
    () => resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'regions', regions: [] }),
    /Choose at least one region/,
  );
  assert.throws(
    () => resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'regions', regions: ['moon'] }),
    /africa, americas, asia, europe, middle-east, oceania/,
  );
});
