import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { analyzeCompleteness } from '../dist/core/completeness.js';
import { defaultConfig, saveConfig } from '../dist/core/config.js';
import { saveMemory } from '../dist/core/memory.js';
import { writeCatalog } from '../dist/core/catalog.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-complete-'));
  const config = {
    ...defaultConfig({
      framework: 'next-app',
      runtime: 'next-intl',
      messagesDir: 'messages',
      layout: 'single-file',
      srcDir: '.',
      runtimeInstalled: true,
      evidence: [],
    }),
    sourceLocale: 'en-US',
    locales: ['en-US', 'de-DE'],
    agents: ['cursor'],
  };
  saveConfig(dir, config);
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app/page.tsx'), [
    "import {useTranslations} from 'next-intl';",
    'export default function Page() {',
    "  const t = useTranslations('hero');",
    "  return <><h1>{t('title')}</h1><p>Still hardcoded copy</p></>;",
    '}',
  ].join('\n'));

  const now = new Date().toISOString();
  const entry = (source, kind, translations = {}) => ({
    source,
    sourceHash: `hash-${source}`,
    namespace: 'hero',
    kind,
    file: 'app/page.tsx',
    placeholders: source.includes('{name}') ? ['{name}'] : [],
    firstSeen: now,
    lastSeen: now,
    translations,
  });
  const translation = (value, status) => ({
    value,
    sourceHash: 'old-hash',
    status,
    updatedAt: now,
    by: 'agent',
  });
  const memory = {
    version: 1,
    sourceLocale: 'en-US',
    updatedAt: now,
    entries: {
      'hero.title': entry('Welcome back', 'heading', {
        'de-DE': translation('Willkommen zurück', 'stale'),
      }),
      'hero.greeting': entry('Hello {name}', 'body', {
        'de-DE': translation('Hallo', 'approved'),
      }),
      'hero.pending': entry('Choose a plan today', 'body', {
        'de-DE': translation('Wähle heute einen Tarif', 'pending'),
      }),
      'hero.missing': entry('Create your first project', 'body'),
    },
  };
  saveMemory(dir, memory);
  writeCatalog(dir, config, 'en-US', Object.fromEntries(
    Object.entries(memory.entries).map(([key, value]) => [key, value.source])
  ));
  writeCatalog(dir, config, 'de-DE', {
    'hero.title': 'Willkommen zurück',
    'hero.greeting': 'Hallo',
    'hero.orphan': 'Alt',
  });
  return { dir, config };
}

function snapshot(dir) {
  const out = {};
  const visit = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) visit(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full).toString('base64');
    }
  };
  visit(dir);
  return out;
}

test('completeness analysis classifies project and locale gaps', () => {
  const { dir, config } = fixture();
  const report = analyzeCompleteness(dir, config);
  const kinds = new Set(report.findings.map((finding) => finding.kind));

  assert.equal(report.complete, false);
  assert.ok(kinds.has('hardcoded'));
  assert.ok(kinds.has('missing-translation'));
  assert.ok(kinds.has('stale'));
  assert.ok(kinds.has('pending'));
  assert.ok(kinds.has('integrity'));
  assert.ok(kinds.has('orphan'));
  assert.equal(report.byLocale['de-DE'].total, 4);
  assert.equal(report.byLocale['de-DE'].missing, 1);
  assert.equal(report.byLocale['de-DE'].stale, 1);
  assert.equal(report.byLocale['de-DE'].pending, 1);
  assert.deepEqual(report.actions.slice(0, 3), ['extract', 'translate', 'retranslate']);
});

test('completeness analysis is byte-for-byte read-only', () => {
  const { dir, config } = fixture();
  const before = snapshot(dir);
  analyzeCompleteness(dir, config);
  assert.deepEqual(snapshot(dir), before);
});
