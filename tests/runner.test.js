import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../dist/core/config.js';
import { runTranslationLoop } from '../dist/core/runner.js';
import { sha } from '../dist/core/util.js';

const WELCOME_SHA256 = 'c5d9b4ccf8cb35e8fdfcd54a6898a577374b86e59dfc395eab7466dfbf2c0c05';
const SCOPE_DIGEST = '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5';

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

function writeSourceCatalogue(cwd, memory) {
  fs.mkdirSync(path.join(cwd, 'messages'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'messages/en.json'),
    JSON.stringify(Object.fromEntries(
      Object.entries(memory.entries).map(([key, entry]) => [key, entry.source]),
    )),
  );
}

function writeHandoff(cwd, keys) {
  fs.mkdirSync(path.join(cwd, '.marketing-loop'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.marketing-loop/handoff.json'), JSON.stringify({
    schemaVersion: 1,
    marketingRunId: 'run',
    scopeDigest: SCOPE_DIGEST,
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    unresolved: keys.map((key) => ({
      key,
      file: 'messages/en.json',
      sourceHash: WELCOME_SHA256,
      status: 'pending',
    })),
  }));
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

test('autonomous run translates identical copy only when its canonical key is not frozen', async () => {
  const { cwd, config, memory } = fixture();
  memory.entries.second = {
    ...structuredClone(memory.entries.greeting),
    namespace: 'second',
  };
  writeSourceCatalogue(cwd, memory);
  writeHandoff(cwd, ['greeting']);
  const seen = [];

  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    translator: async (batch) => {
      seen.push(...batch.units.map((unit) => unit.key));
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: 'Willkommen, {name}',
      }));
    },
    judge: async (_batch, _artifact, units) =>
      units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true })),
  });

  assert.deepEqual(seen, ['second']);
  assert.equal(summary.marketingBlocked, 1);
  assert.equal(summary.status, 'waiting-marketing');
});

test('autonomous run waits without calling providers when every pending key is frozen', async () => {
  const { cwd, config, memory } = fixture();
  writeSourceCatalogue(cwd, memory);
  writeHandoff(cwd, ['greeting']);
  let providerCalls = 0;

  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    translator: async () => {
      providerCalls++;
      return [];
    },
    judge: async () => {
      providerCalls++;
      return [];
    },
  });

  assert.equal(providerCalls, 0);
  assert.equal(summary.status, 'waiting-marketing');
  assert.equal(summary.marketingBlocked, 1);
  assert.equal(summary.batches, 0);
});

test('exact-key runs retry to judge acceptance and finish every selected language', async () => {
  const { cwd, config, memory } = fixture();
  config.locales = ['en', 'de', 'fr'];
  config.maxBatch = 1;
  memory.entries.body = {
    ...structuredClone(memory.entries.greeting),
    source: 'Account details',
    sourceHash: sha('Account details'),
    kind: 'body',
    placeholders: [],
    translations: {
      de: {
        value: 'Kontodaten aus dem Speicher',
        sourceHash: sha('Account details'),
        status: 'approved',
        updatedAt: '',
        by: 'judge',
      },
      fr: {
        value: 'Détails du compte en mémoire',
        sourceHash: sha('Account details'),
        status: 'approved',
        updatedAt: '',
        by: 'judge',
      },
    },
  };
  fs.mkdirSync(path.join(cwd, 'messages'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'messages', 'en.json'),
    JSON.stringify({
      greeting: 'Welcome, {name}',
      body: 'OUT OF SCOPE SOURCE',
    }),
  );
  fs.writeFileSync(
    path.join(cwd, 'messages', 'de.json'),
    JSON.stringify({ body: 'AUSSERHALB DES BEREICHS' }),
  );
  fs.writeFileSync(
    path.join(cwd, 'messages', 'fr.json'),
    JSON.stringify({ body: 'HORS PÉRIMÈTRE' }),
  );
  const seen = [];
  const events = [];
  let rejectedGermanOnce = false;

  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    keys: ['greeting'],
    onProgress: async (event) => events.push(structuredClone(event)),
    translator: async (batch) => {
      seen.push(...batch.units.map((unit) => `${unit.locale}:${unit.key}`));
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: unit.locale === 'de'
          ? 'Willkommen, {name}'
          : 'Bienvenue, {name}',
      }));
    },
    judge: async (_batch, _artifact, units) => units.map((unit) => {
      if (unit.locale === 'de' && !rejectedGermanOnce) {
        rejectedGermanOnce = true;
        return {
          key: unit.key,
          locale: unit.locale,
          ok: false,
          reason: 'use the requested informal register',
        };
      }
      return { key: unit.key, locale: unit.locale, ok: true };
    }),
  });

  assert.equal(summary.status, 'complete');
  assert.deepEqual(summary.selectedKeys, ['greeting']);
  assert.deepEqual(seen, [
    'de:greeting',
    'de:greeting',
    'fr:greeting',
  ]);
  assert.deepEqual(
    summary.progress.map(({ locale, status, accepted, total }) => ({
      locale,
      status,
      accepted,
      total,
    })),
    [
      { locale: 'de', status: 'complete', accepted: 1, total: 1 },
      { locale: 'fr', status: 'complete', accepted: 1, total: 1 },
    ],
  );
  assert.equal(events[0].batches, 0, 'initial progress is observable before providers run');
  assert.equal(events.at(-1).status, 'complete');
  assert.equal(events.length, summary.batches + 1);
  assert.equal(
    memory.entries.body.translations.de.value,
    'Kontodaten aus dem Speicher',
  );
  assert.equal(
    memory.entries.body.translations.fr.value,
    'Détails du compte en mémoire',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'en.json'), 'utf8')).body,
    'OUT OF SCOPE SOURCE',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'de.json'), 'utf8')).body,
    'AUSSERHALB DES BEREICHS',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'fr.json'), 'utf8')).body,
    'HORS PÉRIMÈTRE',
  );
});

test('omitting exact keys preserves the existing all-key runner behavior', async () => {
  const { cwd, config, memory } = fixture();
  memory.entries.body = {
    ...structuredClone(memory.entries.greeting),
    source: 'Account details',
    sourceHash: sha('Account details'),
    kind: 'body',
    placeholders: [],
    translations: {},
  };
  const seen = [];

  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    translator: async (batch) => {
      seen.push(...batch.units.map((unit) => unit.key));
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: unit.key === 'greeting' ? 'Willkommen, {name}' : 'Kontodaten',
      }));
    },
    judge: async (_batch, _artifact, units) =>
      units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true })),
  });

  assert.equal(summary.status, 'complete');
  assert.deepEqual(seen.sort(), ['body', 'greeting']);
  assert.deepEqual(summary.selectedKeys, ['body', 'greeting']);
});

test('exact locale scopes never apply memory values to unselected target catalogues', async () => {
  const { cwd, config, memory } = fixture();
  config.locales = ['en', 'de', 'fr'];
  memory.entries.greeting.translations.fr = {
    value: 'Bienvenue depuis la mémoire, {name}',
    sourceHash: memory.entries.greeting.sourceHash,
    status: 'approved',
    updatedAt: '',
    by: 'judge',
  };
  fs.mkdirSync(path.join(cwd, 'messages'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'messages', 'en.json'),
    JSON.stringify({ greeting: 'Welcome, {name}' }),
  );
  fs.writeFileSync(
    path.join(cwd, 'messages', 'fr.json'),
    JSON.stringify({ greeting: 'NE PAS MODIFIER, {name}' }),
  );

  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    keys: ['greeting'],
    locales: ['de'],
    translator: async (batch) => batch.units.map((unit) => ({
      key: unit.key,
      locale: unit.locale,
      value: 'Willkommen, {name}',
    })),
    judge: async (_batch, _artifact, units) =>
      units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true })),
  });

  assert.equal(summary.status, 'complete');
  assert.deepEqual(summary.progress.map((item) => item.locale), ['de']);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'fr.json'), 'utf8')).greeting,
    'NE PAS MODIFIER, {name}',
  );
});

test('explicit empty and invalid exact-key scopes never reach providers', async () => {
  const { cwd, config, memory } = fixture();
  let providerCalls = 0;
  const translator = async () => {
    providerCalls++;
    return [];
  };
  const judge = async () => {
    providerCalls++;
    return [];
  };

  const empty = await runTranslationLoop({
    cwd,
    memory,
    config,
    keys: [],
    translator,
    judge,
  });
  assert.equal(empty.status, 'complete');
  assert.deepEqual(empty.selectedKeys, []);
  assert.equal(providerCalls, 0);

  const noLocales = await runTranslationLoop({
    cwd,
    memory,
    config,
    keys: ['greeting'],
    locales: [],
    translator,
    judge,
  });
  assert.equal(noLocales.status, 'complete');
  assert.deepEqual(noLocales.progress, []);
  assert.equal(providerCalls, 0);

  await assert.rejects(
    runTranslationLoop({
      cwd,
      memory,
      config,
      keys: ['missing.key'],
      translator,
      judge,
    }),
    (error) => error?.code === 'FILTER_MISMATCH' && /missing\.key/.test(error.message),
  );
  assert.equal(providerCalls, 0);
});

test('legacy pending translations are not complete until a fresh candidate is judge accepted', async () => {
  const { cwd, config, memory } = fixture();
  memory.entries.greeting.translations.de = {
    value: 'Nicht geprüft, {name}',
    sourceHash: memory.entries.greeting.sourceHash,
    status: 'pending',
    updatedAt: '',
    by: 'legacy',
  };
  let calls = 0;

  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    keys: ['greeting'],
    translator: async (batch) => {
      calls++;
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: 'Willkommen, {name}',
      }));
    },
    judge: async (_batch, _artifact, units) =>
      units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true })),
  });

  assert.equal(calls, 1);
  assert.equal(summary.status, 'complete');
  assert.equal(memory.entries.greeting.translations.de.status, 'approved');
});

test('unresolved Marketing keys outside an exact run never expand or pause its scope', async () => {
  const { cwd, config, memory } = fixture();
  memory.entries.second = {
    ...structuredClone(memory.entries.greeting),
    namespace: 'second',
    translations: {},
  };
  writeSourceCatalogue(cwd, memory);
  writeHandoff(cwd, ['greeting']);
  const seen = [];

  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    keys: ['second'],
    translator: async (batch) => {
      seen.push(...batch.units.map((unit) => unit.key));
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: 'Willkommen, {name}',
      }));
    },
    judge: async (_batch, _artifact, units) =>
      units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true })),
  });

  assert.deepEqual(seen, ['second']);
  assert.equal(summary.status, 'complete');
  assert.equal(summary.marketingBlocked, 0);
  assert.deepEqual(summary.selectedKeys, ['second']);
});
