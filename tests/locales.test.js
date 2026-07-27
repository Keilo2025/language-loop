import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMON_LOCALES,
  allCommonLocaleCodes,
  canonicalLocaleCode,
  localesForRegions,
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
