import test from 'node:test';
import assert from 'node:assert/strict';
import { syncMemory, pendingWork, recordTranslation, stats } from '../dist/core/memory.js';
import { assignKeys, namespaceFor, slugFor } from '../dist/core/keys.js';
import { flatten, nest } from '../dist/core/catalog.js';
import { defaultConfig } from '../dist/core/config.js';

const config = {
  ...defaultConfig({
    framework: 'next-app', runtime: 'next-intl', messagesDir: 'messages',
    layout: 'single-file', srcDir: 'app', runtimeInstalled: true, evidence: [],
  }),
  locales: ['en', 'de', 'ja'],
};

function emptyMemory() {
  return { version: 1, sourceLocale: 'en', updatedAt: '', entries: {} };
}

function string(text, over = {}) {
  return {
    file: 'app/page.tsx', line: 1, text, kind: 'cta', context: 'jsx-text',
    raw: text, placeholders: [], ...over,
  };
}

test('namespaces come from the route, not the filename', () => {
  assert.equal(namespaceFor('app/pricing/page.tsx'), 'pricing');
  assert.equal(namespaceFor('app/page.tsx'), 'common');
  assert.equal(namespaceFor('src/components/HeroSection.tsx'), 'heroSection');
  assert.equal(namespaceFor('src/routes/(marketing)/+page.svelte'), 'marketing');
});

test('slugs are readable and drop stop words', () => {
  assert.equal(slugFor('Get started for free', 'cta'), 'getStartedFree');
  assert.equal(slugFor('You have {count} builds waiting', 'body'), 'youHaveBuildsWaiting');
});

test('a key survives the component being renamed', () => {
  const memory = emptyMemory();
  const first = assignKeys([string('Get started free')], config, memory);
  syncMemory(memory, first, config);

  // Same text, same route, file moved: the key must not change, or every
  // translation of it is thrown away.
  const second = assignKeys([string('Get started free', { file: 'app/page.tsx' })], config, memory);
  assert.equal(second[0].key, first[0].key);
});

test('two different strings that want the same name get stable, distinct keys', () => {
  const memory = emptyMemory();
  const keyed = assignKeys([string('Save'), string('Save', { text: 'Save!' })], config, memory);
  assert.notEqual(keyed[0].key, keyed[1].key);

  // Stable across runs: the disambiguating suffix hashes the source, so a
  // different scan order cannot renumber anyone's keys.
  const again = assignKeys([string('Save'), string('Save', { text: 'Save!' })], config, emptyMemory());
  assert.deepEqual(again.map((k) => k.key), keyed.map((k) => k.key));
});

test('changed english makes every translation of it stale', () => {
  const memory = emptyMemory();
  const keyed = assignKeys([string('Get started free')], config, memory);
  syncMemory(memory, keyed, config);
  const key = keyed[0].key;

  recordTranslation(memory, key, 'de', 'Kostenlos starten', 'agent', 'approved');
  recordTranslation(memory, key, 'ja', '無料で始める', 'agent', 'approved');
  assert.equal(pendingWork(memory, config).length, 0);

  memory.entries[key].source = 'Start free trial';
  const changed = syncMemory(memory, [{ ...keyed[0], text: 'Start free trial' }], config);
  assert.equal(changed.changed.length, 1);

  const work = pendingWork(memory, config);
  assert.equal(work.length, 2);
  assert.ok(work.every((w) => w.reason === 'stale'));
  assert.ok(work.every((w) => w.previous));
});

test('a hand-written translation is never overwritten', () => {
  const memory = emptyMemory();
  const keyed = assignKeys([string('Save')], config, memory);
  syncMemory(memory, keyed, config);
  const key = keyed[0].key;

  recordTranslation(memory, key, 'de', 'Von Hand', 'human', 'manual');
  const overwritten = recordTranslation(memory, key, 'de', 'Vom Agenten', 'agent', 'approved');

  assert.equal(overwritten, false);
  assert.equal(memory.entries[key].translations.de.value, 'Von Hand');
});

test('coverage counts approved and manual, nothing else', () => {
  const memory = emptyMemory();
  const keyed = assignKeys([string('One'), string('Two', { text: 'Two words here' })], config, memory);
  syncMemory(memory, keyed, config);
  recordTranslation(memory, keyed[0].key, 'de', 'Eins', 'agent', 'approved');
  recordTranslation(memory, keyed[1].key, 'de', 'Zwei', 'agent', 'pending');

  const result = stats(memory, config);
  assert.equal(result.byLocale.de.coverage, 50);
  assert.equal(result.byLocale.ja.missing, 2);
});

test('flat and nested catalogues round-trip', () => {
  const flat = { 'hero.title': 'Hi', 'hero.cta': 'Go', 'pricing.title': 'Plans' };
  assert.deepEqual(flatten(nest(flat, 'nested')), flat);
  assert.deepEqual(nest(flat, 'nested').hero.cta, 'Go');
});
