import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTranslations, partition } from '../dist/core/guardrails.js';
import { defaultConfig } from '../dist/core/config.js';

function baseConfig(overrides = {}) {
  const config = defaultConfig({
    framework: 'react', runtime: 'react-i18next', messagesDir: 'locales',
    layout: 'single-file', srcDir: 'src', runtimeInstalled: true, evidence: [],
  });
  return { ...config, ...overrides, voice: { ...config.voice, ...(overrides.voice ?? {}) } };
}

function unit(over = {}) {
  return {
    key: 'k', locale: 'de', source: 'Hello {name}', value: 'Hallo {name}',
    kind: 'body', file: 'a.tsx', placeholders: ['{name}'], status: 'pending', ...over,
  };
}

test('a lost placeholder is blocked, not merely flagged', () => {
  const issues = checkTranslations([unit({ value: 'Hallo du' })], baseConfig());
  const lost = issues.find((i) => i.rule === 'placeholder-lost');
  assert.ok(lost);
  assert.equal(lost.severity, 'block');
});

test('an invented placeholder is blocked', () => {
  const issues = checkTranslations([unit({ value: 'Hallo {name} {other}' })], baseConfig());
  assert.ok(issues.some((i) => i.rule === 'placeholder-invented' && i.severity === 'block'));
});

test('reordering a placeholder to suit the grammar is fine', () => {
  const issues = checkTranslations(
    [unit({ source: 'Welcome back, {name}', value: '{name}、おかえりなさい', locale: 'ja', placeholders: ['{name}'] })],
    baseConfig()
  );
  assert.equal(issues.filter((i) => i.severity === 'block').length, 0);
});

test('unbalanced markup and braces are blocked', () => {
  const config = baseConfig();
  assert.ok(checkTranslations([unit({ source: 'Read <b>this</b>', value: 'Lies <b>das', placeholders: [] })], config)
    .some((i) => i.rule === 'markup-unbalanced'));
  assert.ok(checkTranslations([unit({ source: 'a', value: 'ein {count', placeholders: [] })], config)
    .some((i) => i.rule === 'icu-unbalanced'));
});

test('polish needs more plural branches than english', () => {
  const issues = checkTranslations(
    [unit({
      locale: 'pl', source: '{count, plural, one {# file} other {# files}}',
      value: '{count, plural, one {# plik} other {# plików}}', placeholders: [],
    })],
    baseConfig()
  );
  assert.ok(issues.some((i) => i.rule === 'plural-category-missing' && i.message.includes('few')));
});

test('a brand name that must survive, and does not, is blocked', () => {
  const config = baseConfig({ voice: { doNotTranslate: ['DeployWatch'] } });
  const issues = checkTranslations(
    [unit({ source: 'DeployWatch is free', value: 'Einsatzbeobachter ist kostenlos', placeholders: [] })],
    config
  );
  assert.ok(issues.some((i) => i.rule === 'brand-term-lost' && i.severity === 'block'));
});

test('a model answering the brief instead of translating is caught', () => {
  const issues = checkTranslations(
    [unit({ value: "Here's the German translation: Hallo {name}" })],
    baseConfig()
  );
  assert.ok(issues.some((i) => i.rule === 'model-preamble' && i.severity === 'block'));
});

test('a button three times the english length is flagged, a paragraph is not', () => {
  const config = baseConfig();
  const long = 'Jetzt vollkommen kostenlos und unverbindlich loslegen';
  const asCta = checkTranslations([unit({ kind: 'cta', source: 'Start', value: long, placeholders: [] })], config);
  const asBody = checkTranslations([unit({ kind: 'body', source: 'Start', value: long, placeholders: [] })], config);
  assert.ok(asCta.some((i) => i.rule === 'too-long'));
  assert.ok(!asBody.some((i) => i.rule === 'too-long'));
});

test('blocked units never reach the reviewer', () => {
  const units = [unit({ key: 'good' }), unit({ key: 'bad', value: 'Hallo' })];
  const issues = checkTranslations(units, baseConfig());
  const { kept, blocked } = partition(units, issues);
  assert.deepEqual(kept.map((u) => u.key), ['good']);
  assert.deepEqual(blocked.map((b) => b.unit.key), ['bad']);
});
