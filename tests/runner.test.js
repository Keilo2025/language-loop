import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../dist/core/config.js';
import { runTranslationLoop } from '../dist/core/runner.js';
import { sha } from '../dist/core/util.js';

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'll-runner-'));
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'src', 'App.tsx'), [
    'export function App() {',
    '  const t = useTranslations();',
    '  return (',
    '    <p>{t("greeting")}</p>',
    '  );',
    '}',
  ].join('\n'));
  const config = {
    ...defaultConfig({
      framework: 'react',
      runtime: 'react-i18next',
      messagesDir: 'messages',
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
        source: 'Welcome, {name}',
        sourceHash: sha('Welcome, {name}'),
        namespace: 'common',
        kind: 'body',
        file: 'src/App.tsx',
        line: 4,
        component: 'App',
        placeholders: ['{name}'],
        firstSeen: '',
        lastSeen: '',
        translations: {},
      },
    },
  };
  return { cwd, config, memory };
}

test('end-to-end LLM run repairs a guardrail failure and applies the second candidate', async () => {
  const { cwd, config, memory } = fixture();
  let translationCalls = 0;
  let judgeCalls = 0;
  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    translator: async (batch) => {
      translationCalls++;
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: translationCalls === 1 ? 'Willkommen' : 'Willkommen, {name}',
      }));
    },
    judge: async (_batch, _artifact, units) => {
      judgeCalls++;
      return units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true }));
    },
  });

  assert.equal(summary.status, 'complete');
  assert.equal(summary.batches, 2);
  assert.equal(summary.applied, 1);
  assert.equal(summary.rework, 1);
  assert.equal(translationCalls, 2);
  assert.equal(judgeCalls, 1, 'mechanically invalid candidates never reach the judge');
  const catalog = JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'de.json'), 'utf8'));
  assert.equal(catalog.greeting, 'Willkommen, {name}');
});

test('end-to-end LLM run stops at the judge retry ceiling', async () => {
  const { cwd, config, memory } = fixture();
  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    translator: async (batch) => batch.units.map((unit) => ({
      key: unit.key,
      locale: unit.locale,
      value: 'Willkommen, {name}',
    })),
    judge: async (_batch, _artifact, units) => units.map((unit) => ({
      key: unit.key,
      locale: unit.locale,
      ok: false,
      reason: 'wrong register',
    })),
  });

  assert.equal(summary.status, 'needs-human');
  assert.equal(summary.batches, config.ai.maxAttempts);
  assert.equal(summary.needsHuman, 1);
  assert.equal(memory.entries.greeting.translations.de.status, 'needs-human');
  assert.equal(memory.entries.greeting.translations.de.attempts, config.ai.maxAttempts);
});

test('end-to-end LLM run dry-run does not write catalogs or mutate caller memory', async () => {
  const { cwd, config, memory } = fixture();
  const before = structuredClone(memory);
  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    dryRun: true,
    translator: async (batch) => batch.units.map((unit) => ({
      key: unit.key,
      locale: unit.locale,
      value: 'Willkommen, {name}',
    })),
    judge: async (_batch, _artifact, units) => units.map((unit) => ({
      key: unit.key,
      locale: unit.locale,
      ok: true,
    })),
  });

  assert.equal(summary.status, 'complete');
  assert.deepEqual(memory, before);
  assert.equal(fs.existsSync(path.join(cwd, 'messages')), false);
  assert.equal(fs.existsSync(path.join(cwd, '.language-loop')), false);
});
