import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { defaultConfig } from '../dist/core/config.js';
import { catalogueScopeDigest } from '../dist/core/catalog.js';
import {
  languageProgress,
  resolveMessageFilter,
  resolveTargetLocales,
} from '../dist/core/selection.js';
import {
  CONTENT_LOOP_API_VERSION,
  extractLanguageLoop,
  inspectLanguageLoop,
  runLanguageLoop,
} from '../dist/orchestration.js';

function memoryFixture() {
  return {
    version: 1,
    sourceLocale: 'en',
    updatedAt: '',
    entries: {
      'hero.title': entry('Welcome', 'heading', 'hero'),
      'hero.startFree': entry('Start free', 'cta', 'hero'),
      'checkout.title': entry('Checkout', 'title', 'checkout'),
      'checkout.description': entry('Pay securely', 'body', 'checkout'),
      'nav.home': entry('Home', 'nav', 'nav'),
    },
  };
}

function entry(source, kind, namespace) {
  return {
    source,
    sourceHash: `hash:${source}`,
    namespace,
    kind,
    file: `src/${namespace}.tsx`,
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {},
  };
}

function projectFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'll-orchestration-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    dependencies: {
      react: '19.0.0',
      'react-i18next': '15.0.0',
    },
  }));
  fs.writeFileSync(path.join(cwd, 'src', 'Hero.tsx'), [
    'export function Hero() {',
    '  return <section>',
    '    <h1>Welcome aboard</h1>',
    '    <button>Start free</button>',
    '    <p>Account details stay private.</p>',
    '  </section>;',
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
    locales: ['en', 'de', 'fr'],
  };
  fs.writeFileSync(
    path.join(cwd, 'language-loop.config.json'),
    JSON.stringify(config, null, 2),
  );
  return { cwd, config };
}

test('message filters normalize categories and resolve a deterministic union of exact keys', () => {
  const memory = memoryFixture();
  const resolved = resolveMessageFilter(memory.entries, {
    categories: ['headline'],
    groups: ['checkout'],
    keys: ['nav.home'],
  });

  assert.deepEqual(resolved.requested, {
    categories: ['headline'],
    groups: ['checkout'],
    keys: ['nav.home'],
  });
  assert.deepEqual(resolved.selectedKeys, [
    'checkout.description',
    'checkout.title',
    'hero.title',
    'nav.home',
  ]);
  assert.deepEqual(resolved.kinds, ['heading', 'title']);
  assert.deepEqual(resolved.unmatchedGroups, []);
  assert.deepEqual(resolved.unmatchedKeys, []);
});

test('button and CTA filters use the scanner canonical CTA kind without broadening scope', () => {
  const memory = memoryFixture();
  const cta = resolveMessageFilter(memory.entries, { categories: ['cta'] });
  const button = resolveMessageFilter(memory.entries, { categories: ['button'] });

  assert.deepEqual(cta.selectedKeys, ['hero.startFree']);
  assert.deepEqual(button.selectedKeys, ['hero.startFree']);
  assert.deepEqual(cta.kinds, ['cta']);
  assert.deepEqual(button.kinds, ['cta']);
});

test('explicit missing keys and groups fail closed', () => {
  const memory = memoryFixture();

  assert.throws(
    () => resolveMessageFilter(memory.entries, { keys: ['missing.key'] }),
    (error) => error?.code === 'FILTER_MISMATCH' && /missing\.key/.test(error.message),
  );
  assert.throws(
    () => resolveMessageFilter(memory.entries, { groups: ['missing'] }),
    (error) => error?.code === 'FILTER_MISMATCH' && /missing/.test(error.message),
  );
});

test('omitted filters select all keys while a provided empty filter selects none', () => {
  const memory = memoryFixture();

  assert.deepEqual(
    resolveMessageFilter(memory.entries).selectedKeys,
    Object.keys(memory.entries).sort(),
  );
  assert.deepEqual(resolveMessageFilter(memory.entries, {}).selectedKeys, []);
});

test('target locales are canonical configured targets only', () => {
  const config = {
    sourceLocale: 'en',
    locales: ['en', 'de-DE', 'fr-FR'],
  };

  assert.deepEqual(resolveTargetLocales(config), ['de-DE', 'fr-FR']);
  assert.deepEqual(resolveTargetLocales(config, ['fr-fr']), ['fr-FR']);
  assert.throws(
    () => resolveTargetLocales(config, ['es-ES']),
    (error) => error?.code === 'INVALID_LOCALE' && /es-ES/.test(error.message),
  );
});

test('per-language progress is complete only for current approved or protected manual values', () => {
  const memory = memoryFixture();
  memory.entries['hero.title'].translations.de = {
    value: 'Willkommen',
    sourceHash: memory.entries['hero.title'].sourceHash,
    status: 'approved',
    updatedAt: '',
    by: 'judge',
  };
  memory.entries['hero.startFree'].translations.de = {
    value: 'Kostenlos starten',
    sourceHash: memory.entries['hero.startFree'].sourceHash,
    status: 'manual',
    updatedAt: '',
    by: 'human',
  };
  memory.entries['hero.title'].translations.fr = {
    value: 'Bienvenue',
    sourceHash: 'stale-hash',
    status: 'approved',
    updatedAt: '',
    by: 'judge',
  };
  memory.entries['hero.startFree'].translations.fr = {
    value: 'Commencer',
    sourceHash: memory.entries['hero.startFree'].sourceHash,
    status: 'needs-human',
    updatedAt: '',
    by: 'agent',
  };
  const keys = new Set(['hero.title', 'hero.startFree']);

  assert.deepEqual(
    languageProgress(memory, ['de', 'fr'], keys, new Set()),
    [
      {
        locale: 'de',
        total: 2,
        accepted: 2,
        pending: 0,
        marketingBlocked: 0,
        needsHuman: 0,
        status: 'complete',
      },
      {
        locale: 'fr',
        total: 2,
        accepted: 0,
        pending: 1,
        marketingBlocked: 0,
        needsHuman: 1,
        status: 'pending',
      },
    ],
  );

  assert.equal(
    languageProgress(memory, ['fr'], keys, new Set(['hero.title']))[0].marketingBlocked,
    1,
  );
});

test('the versioned orchestration facade inspects and extracts only selected CTA copy', () => {
  const { cwd } = projectFixture();

  assert.equal(CONTENT_LOOP_API_VERSION, 1);
  const before = inspectLanguageLoop({
    cwd,
    filter: { categories: ['cta'] },
  });
  assert.equal(before.schemaVersion, 1);
  assert.equal(before.apiVersion, 1);
  assert.equal(before.phase, 'needs-extraction');
  assert.equal(before.nextStage, 'extract');
  assert.deepEqual(before.filter.selectedKeys, ['hero.startFree']);
  assert.equal(before.hardcoded, 1);

  const extracted = extractLanguageLoop({
    cwd,
    filter: { categories: ['cta'] },
  });
  assert.equal(extracted.schemaVersion, 1);
  assert.deepEqual(extracted.filter.selectedKeys, ['hero.startFree']);
  assert.equal(extracted.applied.length, 1);
  assert.equal(extracted.openItems.length, 0);

  const source = fs.readFileSync(path.join(cwd, 'src', 'Hero.tsx'), 'utf8');
  assert.match(source, /t\('startFree'\)/);
  assert.match(source, /<h1>Welcome aboard<\/h1>/);
  assert.match(source, /<p>Account details stay private\.<\/p>/);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'en.json'), 'utf8')),
    { hero: { startFree: 'Start free' } },
  );

  const after = inspectLanguageLoop({
    cwd,
    filter: { categories: ['cta'] },
  });
  assert.equal(after.phase, 'ready-translation');
  assert.equal(after.hardcoded, 0);
  assert.deepEqual(
    after.progress.map(({ locale, pending, total }) => ({ locale, pending, total })),
    [
      { locale: 'de', pending: 1, total: 1 },
      { locale: 'fr', pending: 1, total: 1 },
    ],
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('an explicit empty extraction filter performs no catalogue or source writes', () => {
  const { cwd } = projectFixture();
  fs.mkdirSync(path.join(cwd, 'messages'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'messages', 'en.json'), '{"external":"KEEP"}');
  const sourceBefore = fs.readFileSync(path.join(cwd, 'src', 'Hero.tsx'));
  const catalogBefore = fs.readFileSync(path.join(cwd, 'messages', 'en.json'));

  const result = extractLanguageLoop({ cwd, filter: {} });

  assert.equal(result.status, 'no-work');
  assert.deepEqual(result.filter.selectedKeys, []);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(
    fs.readFileSync(path.join(cwd, 'src', 'Hero.tsx')),
    sourceBefore,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(cwd, 'messages', 'en.json')),
    catalogBefore,
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('high-level orchestration completes every selected language without touching other categories', async () => {
  const { cwd } = projectFixture();
  extractLanguageLoop({
    cwd,
    filter: { categories: ['cta'] },
  });
  const events = [];
  const seen = [];

  const result = await runLanguageLoop({
    cwd,
    filter: { categories: ['cta'] },
    onProgress: (event) => events.push(structuredClone(event)),
    translator: async (batch) => {
      seen.push(...batch.units.map((unit) => `${unit.locale}:${unit.key}`));
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: unit.locale === 'de' ? 'Kostenlos starten' : 'Démarrer',
      }));
    },
    judge: async (_batch, _artifact, units) =>
      units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true })),
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.apiVersion, 1);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.filter.selectedKeys, ['hero.startFree']);
  assert.deepEqual(seen, ['de:hero.startFree', 'fr:hero.startFree']);
  assert(result.progress.every((locale) => locale.status === 'complete'));
  assert.equal(events.at(-1).status, 'complete');

  const de = JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'de.json'), 'utf8'));
  const fr = JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'fr.json'), 'utf8'));
  assert.deepEqual(de, { hero: { startFree: 'Kostenlos starten' } });
  assert.deepEqual(fr, { hero: { startFree: 'Démarrer' } });
  assert.equal(
    inspectLanguageLoop({ cwd, filter: { categories: ['cta'] } }).phase,
    'complete',
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('an authoritative handoff selection is inherited and caller mismatches fail closed', async () => {
  const { cwd, config } = projectFixture();
  extractLanguageLoop({
    cwd,
    filter: { categories: ['cta'] },
  });
  fs.mkdirSync(path.join(cwd, '.marketing-loop'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.marketing-loop', 'handoff.json'), JSON.stringify({
    schemaVersion: 1,
    marketingRunId: 'content-run',
    scopeDigest: catalogueScopeDigest(cwd, config),
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    unresolved: [],
    selection: {
      filter: { categories: ['cta'] },
      resolvedKeys: ['hero.startFree'],
      targetLocales: ['de'],
    },
  }));

  const inherited = inspectLanguageLoop({ cwd });
  assert.equal(inherited.phase, 'ready-translation');
  assert.deepEqual(inherited.filter.selectedKeys, ['hero.startFree']);
  assert.deepEqual(inherited.targetLocales, ['de']);
  assert.deepEqual(inherited.marketing.selection.targetLocales, ['de']);

  const mismatch = inspectLanguageLoop({
    cwd,
    filter: { categories: ['headline'] },
  });
  assert.equal(mismatch.phase, 'blocked');
  assert.equal(mismatch.error.code, 'SELECTION_MISMATCH');

  let providerCalls = 0;
  const result = await runLanguageLoop({
    cwd,
    translator: async (batch) => {
      providerCalls++;
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: 'Kostenlos starten',
      }));
    },
    judge: async (_batch, _artifact, units) =>
      units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true })),
  });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.targetLocales, ['de']);
  assert.equal(providerCalls, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(cwd, 'messages', 'fr.json'), 'utf8')).hero.startFree,
    'Start free',
  );

  await assert.rejects(
    runLanguageLoop({
      cwd,
      locales: ['fr'],
      translator: async () => [],
      judge: async () => [],
    }),
    (error) => error?.code === 'SELECTION_MISMATCH',
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('the Content Loop capability and orchestration subpath are explicit package contracts', async () => {
  const root = await import('../dist/index.js');
  const pkg = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(root.CONTENT_LOOP_API_VERSION, 1);
  assert.equal(typeof root.inspectLanguageLoop, 'function');
  assert.equal(typeof root.extractLanguageLoop, 'function');
  assert.equal(typeof root.runLanguageLoop, 'function');
  assert.equal(pkg.exports['./orchestration'], './dist/orchestration.js');
});

test('the orchestration CLI mirrors status and filtered extraction as JSON', () => {
  const { cwd } = projectFixture();
  const cli = new URL('../dist/cli.js', import.meta.url);
  const status = spawnSync(process.execPath, [
    cli.pathname,
    'orchestrate',
    'status',
    '--cwd',
    cwd,
    '--categories',
    'cta',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(status.status, 2, status.stderr);
  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.apiVersion, 1);
  assert.equal(snapshot.phase, 'needs-extraction');
  assert.deepEqual(snapshot.filter.selectedKeys, ['hero.startFree']);

  const extraction = spawnSync(process.execPath, [
    cli.pathname,
    'orchestrate',
    'extract',
    '--cwd',
    cwd,
    '--categories',
    'cta',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(extraction.status, 0, extraction.stderr);
  const result = JSON.parse(extraction.stdout);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.filter.selectedKeys, ['hero.startFree']);
  assert.doesNotMatch(extraction.stdout, /language-loop|next:/i);

  const invalid = spawnSync(process.execPath, [
    cli.pathname,
    'orchestrate',
    'translate',
    '--cwd',
    cwd,
    '--categories',
    'cta',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.deepEqual(JSON.parse(invalid.stdout), {
    schemaVersion: 1,
    apiVersion: 1,
    status: 'error',
    error: {
      code: 'INVALID_STATE',
      message: 'orchestrate translate requires --llm or direct module adapters',
    },
  });
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('legacy extract and autonomous run commands delegate to the orchestration facade', () => {
  const cliSource = fs.readFileSync(
    new URL('../src/cli.ts', import.meta.url),
    'utf8',
  );
  const extractBody = cliSource.slice(
    cliSource.indexOf('function cmdExtract'),
    cliSource.indexOf('async function cmdTranslate'),
  );
  const runBody = cliSource.slice(
    cliSource.indexOf('async function cmdRun'),
    cliSource.indexOf('function cmdEval'),
  );

  assert.match(extractBody, /extractLanguageLoop\(/);
  assert.doesNotMatch(extractBody, /new Backup|applyExtraction\(/);
  assert.match(runBody, /runLanguageLoop\(/);
  assert.doesNotMatch(runBody, /runTranslationLoop\(/);
});

test('help documents the unified orchestration lifecycle and filter flags', () => {
  const cli = new URL('../dist/cli.js', import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, 'help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /orchestrate status\|extract\|translate/);
  assert.match(result.stdout, /--categories/);
  assert.match(result.stdout, /--groups/);
  assert.match(result.stdout, /--keys/);
  assert.match(result.stdout, /every selected language/i);
});
