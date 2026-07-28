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

test('all stays dialect-first while everything opens the long tail', () => {
  const audience = resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'all' });
  const everything = resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'everything' });
  assert.ok(everything.length > audience.length);
  assert.ok(audience.includes('pt-BR'));
  assert.ok(!audience.includes('pt'), 'all must not offer the bare language over the dialect');
  assert.ok(everything.includes('eo'));
  assert.equal(everything[0], 'en-US');
  assert.equal(everything.filter((code) => code === 'en-US').length, 1);
});

test('a region now reaches its long-tail languages, not only the listed ones', () => {
  const africa = resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'regions', regions: ['africa'] });
  assert.ok(africa.includes('sw-KE'));
  assert.ok(africa.includes('ln'), 'Lingala should be reachable via Africa');
});
