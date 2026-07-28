import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../dist/core/config.js';
import { pendingWork, recordVerdicts } from '../dist/core/memory.js';

function fixture() {
  const config = {
    ...defaultConfig({
      framework: 'react',
      runtime: 'react-i18next',
      messagesDir: 'locales',
      layout: 'single-file',
      srcDir: 'src',
      runtimeInstalled: true,
      evidence: [],
    }),
    sourceLocale: 'en',
    locales: ['en', 'de'],
  };
  const memory = {
    version: 1,
    sourceLocale: 'en',
    updatedAt: '',
    entries: {
      greeting: {
        source: 'Hello',
        sourceHash: 'source-hash',
        namespace: 'common',
        kind: 'body',
        file: 'src/App.tsx',
        placeholders: [],
        firstSeen: '',
        lastSeen: '',
        translations: {},
      },
    },
  };
  return { config, memory };
}

test('guardrail feedback and retry ceiling use the same bounded transition', () => {
  const { config, memory } = fixture();
  const values = new Map([['greeting::de', '']]);
  const rejection = [{
    key: 'greeting',
    locale: 'de',
    ok: false,
    reason: 'empty: translation is empty',
  }];

  const first = recordVerdicts(memory, rejection, values, config);
  assert.deepEqual(first, { rework: 1, passed: 0, needsHuman: 0 });
  assert.equal(memory.entries.greeting.translations.de.status, 'rework');
  assert.equal(memory.entries.greeting.translations.de.attempts, 1);
  assert.match(memory.entries.greeting.translations.de.judgeNote, /empty/);
  assert.equal(pendingWork(memory, config).length, 1);

  const second = recordVerdicts(memory, rejection, values, config);
  assert.deepEqual(second, { rework: 0, passed: 0, needsHuman: 1 });
  assert.equal(memory.entries.greeting.translations.de.status, 'needs-human');
  assert.equal(memory.entries.greeting.translations.de.attempts, 2);
  assert.equal(pendingWork(memory, config).length, 0);
});

test('successful verdicts do not consume retry attempts', () => {
  const { config, memory } = fixture();
  const result = recordVerdicts(
    memory,
    [{ key: 'greeting', locale: 'de', ok: true }],
    new Map([['greeting::de', 'Hallo']]),
    config
  );
  assert.deepEqual(result, { rework: 0, passed: 1, needsHuman: 0 });
  assert.equal(memory.entries.greeting.translations.de, undefined);
});
