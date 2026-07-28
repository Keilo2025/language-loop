import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMON_LOCALES,
  allCommonLocaleCodes,
  allLocaleCodes,
  canonicalLocaleCode,
  localesForRegions,
  searchLocales,
} from '../dist/core/locales.js';

test('common locale catalogue uses unique canonical audience locales', () => {
  const codes = COMMON_LOCALES.map((locale) => locale.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(codes.map(canonicalLocaleCode), codes);
  assert.ok(codes.includes('en-US'));
  assert.ok(codes.includes('en-GB'));
  assert.ok(codes.includes('pt-BR'));
  assert.ok(codes.includes('pt-PT'));
  assert.ok(codes.includes('es-419'));
  assert.ok(codes.includes('zh-Hans-CN'));
  assert.ok(codes.includes('zh-Hant-TW'));
});

test('all common locales is stable and omits replaced generic codes', () => {
  const codes = allCommonLocaleCodes();
  assert.deepEqual(codes, allCommonLocaleCodes());
  assert.ok(codes.length >= 80);
  assert.ok(!codes.includes('en'));
  assert.ok(!codes.includes('es'));
  assert.ok(!codes.includes('pt'));
});

test('region selection combines multi-region locales without duplicates', () => {
  const codes = localesForRegions(['africa', 'middle-east']).map((locale) => locale.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.includes('ar-EG'));
  assert.ok(codes.includes('ar-SA'));
});

test('custom BCP-47 codes are canonicalized and invalid codes are rejected', () => {
  assert.equal(canonicalLocaleCode('EN-us'), 'en-US');
  assert.throws(() => canonicalLocaleCode('not_a_locale'), /Invalid locale code/);
});

test('every known written language is reachable, not just the audience locales', () => {
  const all = allLocaleCodes();
  const audience = allCommonLocaleCodes();
  assert.ok(all.length > audience.length);
  assert.ok(all.length >= 300, `expected the long tail, got ${all.length}`);
  // Bare languages that have no audience locale must still be offerable.
  for (const code of ['eo', 'cy', 'la', 'yi', 'ug', 'bo']) {
    assert.ok(all.includes(code), `${code} missing from the catalogue`);
  }
  // ...without polluting the audience list, which stays dialect-first.
  assert.ok(!audience.includes('eo'));
});

test('every catalogue entry has a real name, not a bare code echoed back', () => {
  for (const locale of COMMON_LOCALES) {
    assert.notEqual(locale.english, locale.code, `${locale.code} has no English name`);
    assert.ok(locale.nativeName.length > 0);
  }
});

test('every language belongs to a region, so region selection can never lose one', () => {
  const orphans = COMMON_LOCALES.filter((locale) => !locale.regions.length);
  assert.deepEqual(orphans.map((l) => l.code), []);
});

test('regional locales carry dialect guidance and bare languages do not claim to', () => {
  const brazil = COMMON_LOCALES.find((l) => l.code === 'pt-BR');
  assert.match(brazil.translationGuidance, /Brazilian/);

  // Derived guidance names the language and the place, and says which register.
  const chile = COMMON_LOCALES.find((l) => l.code === 'es-CL');
  assert.match(chile.translationGuidance, /everyday Spanish of Chile/);
  assert.match(chile.translationGuidance, /not a neutral or textbook variety/);

  // A bare language has no country, so it must not promise a local dialect.
  const bare = COMMON_LOCALES.find((l) => l.code === 'sw');
  assert.equal(bare.translationGuidance, undefined);
});

test('search finds a language by English name, endonym and code', () => {
  assert.ok(searchLocales('swahili').some((l) => l.code === 'sw-KE'));
  assert.ok(searchLocales('deutsch').some((l) => l.code === 'de-DE'));
  assert.ok(searchLocales('pt-B').some((l) => l.code === 'pt-BR'));
  assert.deepEqual(searchLocales('   '), []);
});
