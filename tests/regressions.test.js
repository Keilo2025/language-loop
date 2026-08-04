import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { scanRepo, scanKeyUsage } from '../dist/core/scan.js';
import { assignKeys } from '../dist/core/keys.js';
import { planExtraction, applyExtraction } from '../dist/core/extract.js';
import { defaultConfig, saveConfig } from '../dist/core/config.js';
import { loadMemory, saveMemory, deadKeys, pruneMemory } from '../dist/core/memory.js';
import { catalogueScopeDigest, nest, readCatalog, writeCatalog } from '../dist/core/catalog.js';
import { applyDecisions } from '../dist/core/apply.js';
import { readJsonPrecious, writeJson } from '../dist/core/util.js';
import { commandForStage } from '../dist/core/report.js';
import {
  bindTranslationArtifact,
  bindVerdictArtifact,
  createBatch,
  writeBatch,
} from '../dist/core/batch.js';
import { sha, sha256 } from '../dist/core/util.js';

/**
 * Regressions for the bugs found in the first scan. Each test is named for the
 * failure it prevents coming back, not for the function it happens to call.
 */

function emptyMemory() {
  return { version: 1, sourceLocale: 'en', updatedAt: new Date().toISOString(), entries: {} };
}

function config(over = {}) {
  return {
    ...defaultConfig({
      framework: 'next-app', runtime: 'next-intl', messagesDir: 'messages',
      layout: 'single-file', srcDir: '.', runtimeInstalled: true, evidence: [],
    }),
    locales: ['en', 'de'],
    ...over,
  };
}

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf8');
  }
  return dir;
}

function projectWithMarketingHandoff({ compatible = true } = {}) {
  const dir = project({
    'app/page.tsx': [
      "import { useTranslations } from 'next-intl';",
      'export default function Page() {',
      "  const t = useTranslations('hero');",
      "  return <h1>{t('getStarted')}</h1>;",
      '}',
    ].join('\n'),
  });
  const cfg = config();
  saveConfig(dir, cfg);
  const memory = emptyMemory();
  memory.entries['hero.getStarted'] = {
    source: 'Get started',
    sourceHash: sha('Get started'),
    namespace: 'hero',
    kind: 'cta',
    file: 'app/page.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {
      de: { value: 'Loslegen', sourceHash: sha('Get started'), status: 'approved', updatedAt: '', by: 'agent' },
    },
  };
  saveMemory(dir, memory);
  writeCatalog(dir, cfg, 'en', { 'hero.getStarted': 'Get started' });
  writeCatalog(dir, cfg, 'de', { 'hero.getStarted': 'Loslegen' });
  fs.mkdirSync(path.join(dir, '.marketing-loop'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.marketing-loop/handoff.json'), JSON.stringify({
    schemaVersion: 1,
    marketingRunId: 'marketing-run',
    scopeDigest: catalogueScopeDigest(dir, cfg),
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    unresolved: [{
      key: 'hero.getStarted',
      file: 'messages/en.json',
      sourceHash: compatible ? sha256('Get started') : 'stale-source-hash',
      status: 'pending',
    }],
  }, null, 2));
  return { dir, cfg };
}

function projectWithInactiveMarketing({ installed }) {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return <h1>Launch your workspace</h1>;',
      '}',
    ].join('\n'),
  });
  saveConfig(dir, config());
  if (installed) fs.writeFileSync(path.join(dir, 'marketing-loop.config.json'), '{}\n');
  return dir;
}

test('sync-marketing presents a missing installation as unavailable', () => {
  const dir = projectWithInactiveMarketing({ installed: false });
  const run = spawnSync(process.execPath, ['dist/cli.js', 'sync-marketing', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /installation: not installed/);
  assert.match(run.stdout, /run: absent/);
  assert.match(run.stdout, /handoff schema: not available/);
  assert.match(run.stdout, /scope: not available/);
  assert.match(run.stdout, /next: npx marketing-loop install/);
});

test('sync-marketing presents an installed never-run handoff as unavailable', () => {
  const dir = projectWithInactiveMarketing({ installed: true });
  const run = spawnSync(process.execPath, ['dist/cli.js', 'sync-marketing', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /installation: installed/);
  assert.match(run.stdout, /run: absent/);
  assert.match(run.stdout, /handoff schema: not available/);
  assert.match(run.stdout, /scope: not available/);
  assert.match(run.stdout, /next: npx marketing-loop propose/);
});

test('status waits on marketing before suggesting translation', () => {
  const { dir } = projectWithMarketingHandoff();
  const run = spawnSync(process.execPath, ['dist/cli.js', 'status', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /waiting on marketing/);
  assert.match(run.stdout, /npx marketing-loop review --ui/);
  assert.doesNotMatch(run.stdout, /npx language-loop translate/);
});

test('audit recommends marketing apply before translation for unresolved handoff keys', () => {
  const { dir } = projectWithMarketingHandoff();
  const run = spawnSync(process.execPath, ['dist/cli.js', 'audit', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /waiting on marketing review/);
  assert.match(run.stdout, /npx marketing-loop review --ui && npx marketing-loop apply/);
  assert.doesNotMatch(run.stdout, /npx language-loop translate/);
});

test('sync-marketing reports compatible handoff diagnostics using exact keys', () => {
  const { dir } = projectWithMarketingHandoff();
  const run = spawnSync(process.execPath, ['dist/cli.js', 'sync-marketing', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /handoff schema: compatible/);
  assert.match(run.stdout, /scope: agreed/);
  assert.match(run.stdout, /unresolved keys: 1/);
  assert.match(run.stdout, /hero\.getStarted/);
  assert.match(run.stdout, /stale key\/hash\/file mismatches: none/);
  assert.match(run.stdout, /next: npx marketing-loop review --ui/);
});

test('sync-marketing reports incompatible handoff diagnostics and proposes regeneration', () => {
  const { dir } = projectWithMarketingHandoff({ compatible: false });
  const run = spawnSync(process.execPath, ['dist/cli.js', 'sync-marketing', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /handoff schema: incompatible/);
  assert.match(run.stdout, /scope: unable to validate/);
  assert.match(run.stdout, /stale key\/hash\/file mismatches: .*source hash/);
  assert.match(run.stdout, /next: npx marketing-loop propose/);
});

function extract(dir, cfg = config()) {
  const scan = scanRepo(dir, cfg);
  const keyed = assignKeys(scan.strings, cfg, emptyMemory());
  const plan = planExtraction(dir, keyed, cfg);
  return { scan, keyed, plan, result: applyExtraction(dir, plan, cfg, false) };
}

function writeWorkflowArtifacts(dir, memory, translations, verdicts) {
  for (const item of translations) {
    memory.entries[item.key].sourceHash = sha(memory.entries[item.key].source);
  }
  saveMemory(dir, memory);
  const work = translations.map((item) => {
    const entry = memory.entries[item.key];
    return {
      key: item.key,
      locale: item.locale,
      source: entry.source,
      kind: entry.kind,
      file: entry.file,
      placeholders: entry.placeholders,
      reason: 'new',
    };
  });
  const batch = createBatch(work, { sourceLocale: memory.sourceLocale });
  const translationArtifact = bindTranslationArtifact(batch, translations, 'test-translator');
  const verdictArtifact = bindVerdictArtifact(batch, translationArtifact, verdicts, 'test-judge');
  writeBatch(dir, batch);
  writeJson(path.join(dir, '.language-loop/translations.json'), translationArtifact);
  writeJson(path.join(dir, '.language-loop/verdicts.json'), verdictArtifact);
}

test('Cursor users are sent to the slash command after extraction', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return <h1>Translate this heading</h1>;',
      '}',
    ].join('\n'),
  });
  saveConfig(dir, config({ agents: ['cursor'] }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\/language-loop translate/);
  assert.doesNotMatch(run.stdout, /npx language-loop translate/);
});

test('Cursor users are sent to the slash command after scanning', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return <h1>Extract this hardcoded heading</h1>;',
      '}',
    ].join('\n'),
  });
  saveConfig(dir, config({ agents: ['cursor'] }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'scan', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\/language-loop extract/);
  assert.doesNotMatch(run.stdout, /npx language-loop extract/);
});

test('Cursor stage handoffs consistently use installed slash commands', () => {
  const cursor = config({ agents: ['cursor'] });
  assert.equal(commandForStage(cursor, 'scan'), '/language-loop scan');
  assert.equal(commandForStage(cursor, 'audit'), '/i18n-audit');
  assert.equal(commandForStage(config({ agents: ['codex'] }), 'scan'), 'npx language-loop scan');
});

test('scan keeps generated sources, locale catalogues, and framework HTML prototypes out of an app scan', () => {
  const dir = project({
    'src/components/ActiveSessionBanner.tsx': [
      'export function ActiveSessionBanner() {',
      '  return <button>Stop</button>;',
      '}',
    ].join('\n'),
    'src/generated/prisma/client.ts': [
      'export function Generated() {',
      '  return <button>Delete database</button>;',
      '}',
    ].join('\n'),
    'src/locales/en.ts': [
      'export function Catalogue() {',
      '  return <button>Existing translation</button>;',
      '}',
    ].join('\n'),
    'prototypes/settings.html': '<button>Discard prototype</button>',
  });

  const scan = scanRepo(dir, config());
  assert.deepEqual(scan.strings.map((item) => item.text), ['Stop']);
});

test('scan ignores skills, docs, and requirement docs so only app copy is translated', () => {
  const dir = project({
    'src/components/StopButton.tsx': [
      'export function StopButton() {',
      '  return <button>Stop</button>;',
      '}',
    ].join('\n'),
    'docs/examples/OnboardingCard.tsx': [
      'export function OnboardingCard() {',
      '  return <button>Documented example copy</button>;',
      '}',
    ].join('\n'),
    'skills/prompting/Demo.tsx': [
      'export function Demo() {',
      '  return <button>Skill demo copy</button>;',
      '}',
    ].join('\n'),
    'prd/CheckoutMock.tsx': [
      'export function CheckoutMock() {',
      '  return <button>Requirement mock copy</button>;',
      '}',
    ].join('\n'),
    'brd/flows.tsx': [
      'export function Flows() {',
      '  return <button>Business requirement copy</button>;',
      '}',
    ].join('\n'),
    'handoff/plan.tsx': [
      'export function Plan() {',
      '  return <button>Handoff plan copy</button>;',
      '}',
    ].join('\n'),
    '.agents/notes.tsx': [
      'export function Notes() {',
      '  return <button>Agent notes copy</button>;',
      '}',
    ].join('\n'),
    'docs/PRD.md': '# Product requirements\n\nThe button says "Delete database".',
    'skills/instructions.toml': '[prompt]\ngoal = "Tell the agent exactly what to build"',
  });

  const scan = scanRepo(dir, config());
  assert.deepEqual(scan.strings.map((item) => item.text), ['Stop']);
  assert.equal(scan.filesScanned, 1);
});

test('scan never reads skills, docs, requirement docs, handoffs, or agent dirs, even when config opts them in', () => {
  const dir = project({
    'src/components/StopButton.tsx': [
      'export function StopButton() {',
      '  return <button>Stop</button>;',
      '}',
    ].join('\n'),
    'docs/examples/OnboardingCard.tsx': [
      'export function OnboardingCard() {',
      '  return <button>Documented example copy</button>;',
      '}',
    ].join('\n'),
    'skills/prompting/Demo.tsx': [
      'export function Demo() {',
      '  return <button>Skill demo copy</button>;',
      '}',
    ].join('\n'),
    'PRD/CheckoutMock.tsx': [
      'export function CheckoutMock() {',
      '  return <button>Requirement mock copy</button>;',
      '}',
    ].join('\n'),
    'handoff/plan.tsx': [
      'export function Plan() {',
      '  return <button>Handoff plan copy</button>;',
      '}',
    ].join('\n'),
    '.agents/notes.tsx': [
      'export function Notes() {',
      '  return <button>Agent notes copy</button>;',
      '}',
    ].join('\n'),
    'guide.mdx': '# Guide\n\nThe button says "Delete database".',
  });
  // A config that whitelists every tsx and mdx and drops every default
  // exclusion still cannot pull instruction material into a scan.
  const cfg = config({ include: ['**/*.tsx', '**/*.mdx'], exclude: [] });

  const scan = scanRepo(dir, cfg);
  assert.deepEqual(scan.strings.map((item) => item.text), ['Stop']);
});

test('apply refuses to write into docs, skills, handoffs, or agent dirs even when an edit targets them', () => {
  const dir = project({
    'docs/examples/OnboardingCard.tsx': 'export const card = { title: "Documented example copy" };',
    'skills/prompting/Demo.tsx': 'export const demo = { title: "Skill demo copy" };',
    'handoff/plan.tsx': 'export const plan = { title: "Handoff plan copy" };',
    '.agents/notes.tsx': 'export const notes = { title: "Agent notes copy" };',
  });
  const cfg = config({ exclude: [] });
  const plan = {
    edits: [
      {
        file: 'docs/examples/OnboardingCard.tsx', line: 1, context: 'literal',
        before: 'Documented example copy', after: "t('documentedExample')",
        key: 'common.documentedExample', reason: 'test',
      },
      {
        file: 'skills/prompting/Demo.tsx', line: 1, context: 'literal',
        before: 'Skill demo copy', after: "t('skillDemo')",
        key: 'common.skillDemo', reason: 'test',
      },
      {
        file: 'handoff/plan.tsx', line: 1, context: 'literal',
        before: 'Handoff plan copy', after: "t('handoffPlan')",
        key: 'common.handoffPlan', reason: 'test',
      },
      {
        file: '.agents/notes.tsx', line: 1, context: 'literal',
        before: 'Agent notes copy', after: "t('agentNotes')",
        key: 'common.agentNotes', reason: 'test',
      },
    ],
    wiring: [],
    openItems: [],
  };

  const result = applyExtraction(dir, plan, cfg);
  assert.equal(fs.readFileSync(path.join(dir, 'docs/examples/OnboardingCard.tsx'), 'utf8'),
    'export const card = { title: "Documented example copy" };');
  assert.equal(fs.readFileSync(path.join(dir, 'skills/prompting/Demo.tsx'), 'utf8'),
    'export const demo = { title: "Skill demo copy" };');
  assert.equal(fs.readFileSync(path.join(dir, 'handoff/plan.tsx'), 'utf8'),
    'export const plan = { title: "Handoff plan copy" };');
  assert.equal(fs.readFileSync(path.join(dir, '.agents/notes.tsx'), 'utf8'),
    'export const notes = { title: "Agent notes copy" };');
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 4);
});

test('apply refuses generated files, stylesheets, and edits without a scanned text context', () => {
  const dir = project({
    'src/generated/prisma/client.ts': 'export const warning = "Delete database";',
    'src/theme.ts': "export const initialTheme = 'system';",
    'styles/theme.css': '.banner::after { content: "Stop session"; }',
  });
  const cfg = config();
  const plan = {
    edits: [
      {
        file: 'src/generated/prisma/client.ts', line: 1,
        before: 'Delete database', after: "t('deleteDatabase')",
        key: 'common.deleteDatabase', reason: 'test',
      },
      {
        file: 'styles/theme.css', line: 1,
        before: 'Stop session', after: "t('stopSession')",
        key: 'common.stopSession', reason: 'test',
      },
      {
        file: 'src/theme.ts', line: 1, context: 'literal',
        before: 'system', after: "t('system')",
        key: 'common.system', reason: 'test',
      },
    ],
    wiring: [],
    openItems: [],
  };

  const result = applyExtraction(dir, plan, cfg);
  assert.equal(fs.readFileSync(path.join(dir, 'src/generated/prisma/client.ts'), 'utf8'),
    'export const warning = "Delete database";');
  assert.equal(fs.readFileSync(path.join(dir, 'styles/theme.css'), 'utf8'),
    '.banner::after { content: "Stop session"; }');
  assert.equal(fs.readFileSync(path.join(dir, 'src/theme.ts'), 'utf8'),
    "export const initialTheme = 'system';");
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 3);
});

test('scan normalizes the catalogue directory and ignores generated banners at arbitrary paths', () => {
  const dir = project({
    'messages/en.ts': 'export const copy = () => <button>Existing translation</button>;',
    'src/prisma-client.ts': [
      '/* DO NOT EDIT — generated by Prisma */',
      'export const Copy = () => <button>Delete database</button>;',
    ].join('\n'),
    'src/api-client.ts': [
      '// Generated by OpenAPI Generator',
      'export const Copy = () => <button>Delete remote account</button>;',
    ].join('\n'),
    'src/Banner.tsx': 'export const Banner = () => <button>Stop</button>;',
    'src/Warning.tsx': 'export const Warning = () => <p>Do not edit this setting manually</p>;',
    'src/Schedule.tsx': 'export const Schedule = () => <p>Your report is automatically generated every Monday</p>;',
  });

  const scan = scanRepo(dir, config({ messagesDir: './messages' }));
  assert.deepEqual(scan.strings.map((item) => item.text),
    ['Stop', 'Your report is automatically generated every Monday', 'Do not edit this setting manually']);
});

test('apply never follows a source symlink outside the project', () => {
  const dir = project({});
  const outside = path.join(path.dirname(dir), `${path.basename(dir)}-linked.tsx`);
  const linked = path.join(dir, 'src/Linked.tsx');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.writeFileSync(outside, 'export const Linked = () => <button>Stop</button>;', 'utf8');
  fs.symlinkSync(outside, linked);
  const plan = {
    edits: [{
      file: 'src/Linked.tsx', line: 1, context: 'jsx-text',
      before: 'Stop', after: "{t('stop')}",
      key: 'common.stop', reason: 'test',
    }],
    wiring: [],
    openItems: [],
  };

  try {
    const result = applyExtraction(dir, plan, config());
    assert.equal(fs.readFileSync(outside, 'utf8'),
      'export const Linked = () => <button>Stop</button>;');
    assert.equal(result.applied.length, 0);
    assert.equal(result.skipped.length, 1);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test('apply refuses a scanner-proven edit whose relative path escapes the project', () => {
  const dir = project({});
  const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside.tsx`);
  fs.writeFileSync(outside, 'export const Banner = () => <button>Stop</button>;', 'utf8');
  const plan = {
    edits: [{
      file: `nested/../../${path.basename(outside)}`,
      line: 1,
      context: 'jsx-text',
      before: 'Stop',
      after: "{t('stop')}",
      key: 'common.stop',
      reason: 'test',
    }],
    wiring: [],
    openItems: [],
  };

  try {
    const result = applyExtraction(dir, plan, config());
    assert.equal(fs.readFileSync(outside, 'utf8'),
      'export const Banner = () => <button>Stop</button>;');
    assert.equal(result.applied.length, 0);
    assert.equal(result.skipped.length, 1);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test('one untrusted edit does not suppress a valid rendered-text edit in the same file', () => {
  const dir = project({
    'src/Banner.tsx': [
      "const initialTheme = 'system';",
      'export function Banner() {',
      '  return <button>Stop</button>;',
      '}',
    ].join('\n'),
  });
  const cfg = config();
  const keyed = assignKeys(scanRepo(dir, cfg).strings, cfg, emptyMemory());
  const plan = planExtraction(dir, keyed, cfg);
  plan.edits.unshift({
    file: 'src/Banner.tsx', line: 1,
    before: 'system', after: "t('system')",
    key: 'common.system', reason: 'test',
  });

  const result = applyExtraction(dir, plan, cfg);
  const content = fs.readFileSync(path.join(dir, 'src/Banner.tsx'), 'utf8');
  assert.match(content, /const initialTheme = 'system';/);
  assert.match(content, /<button>\{t\('stop'\)\}<\/button>/);
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 1);
});

test('apply accepts a guardrail-clean translated batch without opening human review', () => {
  const dir = project({});
  const cfg = config();
  saveConfig(dir, cfg);
  const memory = emptyMemory();
  memory.entries['common.helloWorld'] = {
    source: 'Hello world',
    sourceHash: 'current-hash',
    namespace: 'common',
    kind: 'body',
    file: 'app/page.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {},
  };
  writeWorkflowArtifacts(dir, memory, [{
      key: 'common.helloWorld',
      locale: 'de',
      value: 'Hallo Welt',
    }], [{ key: 'common.helloWorld', locale: 'de', ok: true }]);

  const run = spawnSync(process.execPath, ['dist/cli.js', 'apply', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readCatalog(dir, cfg, 'de')['common.helloWorld'], 'Hallo Welt');
  assert.equal(loadMemory(dir, 'en').entries['common.helloWorld'].translations.de.status, 'approved');
  assert.doesNotMatch(run.stdout, /review|approve something/i);
});

test('automatic apply holds flagged translations back instead of asking a non-speaker to decide', () => {
  const dir = project({});
  const cfg = config();
  saveConfig(dir, cfg);
  const memory = emptyMemory();
  memory.entries['common.sourceCodeFragment'] = {
    source: '(ADD_ONS); const parallaxRef = useRef',
    sourceHash: 'current-hash',
    namespace: 'common',
    kind: 'body',
    file: 'app/page.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {},
  };
  writeWorkflowArtifacts(dir, memory, [{
      key: 'common.sourceCodeFragment',
      locale: 'de',
      value: '(ADD_ONS); const parallaxRef = useRef',
      note: 'REJECT — extract error: source code fragment, not UI copy.',
    }], [{
      key: 'common.sourceCodeFragment',
      locale: 'de',
      ok: false,
      reason: 'untranslated: identical to the source',
      by: 'guardrail',
    }]);

  const run = spawnSync(process.execPath, ['dist/cli.js', 'apply', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readCatalog(dir, cfg, 'de')['common.sourceCodeFragment'], undefined);
  assert.match(run.stdout, /held back/i);
  assert.doesNotMatch(run.stdout, /review --ui|i18n-review|approve something/i);
});

test('the removed review command cannot create a human approval flow', () => {
  const dir = project({});
  const cfg = config();
  saveConfig(dir, cfg);
  const memory = emptyMemory();
  memory.entries['common.helloWorld'] = {
    source: 'Hello world',
    sourceHash: 'current-hash',
    namespace: 'common',
    kind: 'body',
    file: 'app/page.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {},
  };
  saveMemory(dir, memory);
  fs.mkdirSync(path.join(dir, '.language-loop'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.language-loop/translations.json'), JSON.stringify({
    translations: [{
      key: 'common.helloWorld',
      locale: 'de',
      value: 'Hallo Welt',
    }],
  }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'review', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Unknown command: review/);
  assert.ok(!fs.existsSync(path.join(dir, '.language-loop/review.md')));
  assert.ok(!fs.existsSync(path.join(dir, '.language-loop/decisions.json')));
});

test('apply ignores legacy human review decisions in favor of the AI judge', () => {
  const dir = project({});
  const cfg = config();
  saveConfig(dir, cfg);
  const memory = emptyMemory();
  memory.entries['common.helloWorld'] = {
    source: 'Hello world',
    sourceHash: 'current-hash',
    namespace: 'common',
    kind: 'body',
    file: 'app/page.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {},
  };
  writeWorkflowArtifacts(
    dir,
    memory,
    [{ key: 'common.helloWorld', locale: 'de', value: 'Falsche Übersetzung' }],
    [{
      key: 'common.helloWorld',
      locale: 'de',
      ok: false,
      reason: 'does not match the English meaning',
    }]
  );
  fs.writeFileSync(path.join(dir, '.language-loop/decisions.json'), JSON.stringify({
    'common.helloWorld::de': {
      key: 'common.helloWorld',
      locale: 'de',
      approved: true,
      value: 'Falsche Übersetzung',
      editedByHuman: true,
    },
  }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'apply', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readCatalog(dir, cfg, 'de')['common.helloWorld'], undefined);
  assert.equal(loadMemory(dir, 'en').entries['common.helloWorld'].translations.de.status, 'rework');
});

test('installing the Cursor command records Cursor for future stage handoffs', () => {
  const dir = project({
    'app/page.tsx': 'export default function Page() { return <h1>Hardcoded heading</h1>; }',
    '.cursor/commands/i18n-review.md': 'Legacy approval canvas command',
  });
  saveConfig(dir, config({ agents: [] }));

  const install = spawnSync(process.execPath, [
    'dist/cli.js', 'install', '--cwd', dir, '--agents', 'cursor',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(install.status, 0, install.stderr);

  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'language-loop.config.json'), 'utf8'));
  assert.ok(saved.agents.includes('cursor'));
  const installedCommand = fs.readFileSync(path.join(dir, '.cursor/commands/language-loop.md'), 'utf8');
  const installedRule = fs.readFileSync(path.join(dir, '.cursor/rules/language-loop.mdc'), 'utf8');
  assert.match(installedCommand, /language-loop apply/);
  assert.match(installedCommand, /Approve correct translations on the user's behalf/i);
  assert.doesNotMatch(installedCommand, /i18n-review|waits? for (the )?user/i);
  assert.match(installedRule, /AI judge is the decision-maker/i);
  assert.doesNotMatch(installedRule, /language-loop review|i18n-review|waits? for (the )?user/i);
  assert.match(
    installedRule,
    /language-loop extract[\s\S]*marketing-loop propose[\s\S]*language-loop translate/
  );
  assert.doesNotMatch(installedRule, /marketing-loop fixes the source copy first, from the code/i);
  assert.ok(
    !fs.existsSync(path.join(dir, '.cursor/commands/i18n-review.md')),
    'updating the plugin must remove the legacy human-approval command'
  );

  const scan = spawnSync(process.execPath, ['dist/cli.js', 'scan', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.match(scan.stdout, /\/language-loop extract/);
});

test('installed agent command owns every remaining batch instead of handing the next stage back', () => {
  const dir = project({});
  saveConfig(dir, config({ agents: [] }));

  const install = spawnSync(process.execPath, [
    'dist/cli.js', 'install', '--cwd', dir, '--agents', 'cursor',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(install.status, 0, install.stderr);

  const installedCommand = fs.readFileSync(path.join(dir, '.cursor/commands/language-loop.md'), 'utf8');
  assert.match(
    installedCommand,
    /A stage argument chooses where the run starts, not where it stops/i,
  );
  assert.match(
    installedCommand,
    /CLI's displayed `next` step is your next internal action/i,
  );
  assert.match(
    installedCommand,
    /Only send a successful final response after\s+`audit` reports\s+complete/i,
  );
  assert.doesNotMatch(
    installedCommand,
    /In your final response, copy the CLI's displayed `next` command exactly/i,
  );
});

test('packaged localization agent applies the same completion gate as the loop command', () => {
  const instructions = fs.readFileSync(
    path.join(process.cwd(), 'agents', 'localization-engineer.md'),
    'utf8',
  );

  assert.match(instructions, /run `status`, then `audit`/i);
  assert.match(instructions, /claim success only when `audit` reports complete/i);
  assert.match(
    instructions,
    /finish every other pending locale before reporting (?:a|the) blocker/i,
  );
});

test('help says exact catalogue keys wait for marketing', () => {
  const help = spawnSync(process.execPath, ['dist/cli.js', 'help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /exact catalogue keys.*waiting for marketing/i);
});

test('non-interactive init can select all common audience locales', () => {
  const dir = project({});
  const run = spawnSync(process.execPath, [
    'dist/cli.js', 'init', '--cwd', dir,
    '--source', 'en-US', '--locales', 'all', '--agents', 'cursor',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'language-loop.config.json'), 'utf8'));
  assert.equal(saved.sourceLocale, 'en-US');
  assert.ok(saved.locales.length >= 80);
  assert.equal(new Set(saved.locales).size, saved.locales.length);
  assert.ok(saved.locales.includes('pt-BR'));
  assert.ok(saved.locales.includes('pt-PT'));
});

test('non-interactive init can select common locales by region', () => {
  const dir = project({});
  const run = spawnSync(process.execPath, [
    'dist/cli.js', 'init', '--cwd', dir,
    '--source', 'en-US', '--regions', 'europe,americas', '--agents', 'cursor',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'language-loop.config.json'), 'utf8'));
  assert.ok(saved.locales.includes('en-GB'));
  assert.ok(saved.locales.includes('es-419'));
  assert.ok(!saved.locales.includes('ja-JP'));
});

test('non-interactive init explains invalid region names', () => {
  const dir = project({});
  const run = spawnSync(process.execPath, [
    'dist/cli.js', 'init', '--cwd', dir,
    '--source', 'en-US', '--regions', 'moon', '--agents', 'cursor',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /africa, americas, asia, europe, middle-east, oceania/);
});

// --- extract must not rewrite TypeScript / toast code as if it were JSX -----

test('TypeScript generics and console.error(… error: …) are not treated as UI copy', () => {
  const before = [
    "'use client';",
    'import { useState, useRef } from "react";',
    'export default function Page() {',
    '  const [loading, setLoading] = useState<boolean | null>(null);',
    '  const heroRef = useRef<HTMLDivElement>(null);',
    '  const handle = async () => {',
    '    try {',
    '      await doThing();',
    '    } catch (error) {',
    '      console.error("Holdings CSV preview error:", error);',
    '      toast.dismiss();',
    '      toast.error(t("importHoldings.previewFailed"));',
    '    }',
    '  };',
    '  return (',
    '    <div>',
    '      <h1>Map Holding Columns</h1>',
    '      <button>Import CSV</button>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');

  const dir = project({ 'app/page.tsx': before });
  const { scan, result } = extract(dir);
  const texts = scan.strings.map((s) => s.text);

  assert.deepEqual(texts.sort(), ['Import CSV', 'Map Holding Columns']);
  assert.equal(
    result.skipped.filter((s) => /source code/i.test(s.reason)).length,
    0,
    'the bad spans should never reach apply',
  );

  const out = fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8');
  assert.match(out, /useState<boolean \| null>\(null\)/);
  assert.match(out, /useRef<HTMLDivElement>\(null\)/);
  assert.match(out, /console\.error\("Holdings CSV preview error:", error\)/);
  assert.match(out, /toast\.dismiss\(\)/);
  assert.match(out, /toast\.error\(t\("importHoldings\.previewFailed"\)\)/);
  assert.match(out, /\{t\('/);
  assert.doesNotMatch(out, /t\('(nullConst|errorToastDismiss|Usestate)/i);
});

test('object-property copy after { or , is still extracted', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      "  const copy = { title: 'Solo plan', description: 'For one engineer' };",
      '  return <h1>{copy.title}</h1>;',
      '}',
    ].join('\n'),
  });

  const { scan } = extract(dir);
  const texts = scan.strings.map((s) => s.text);
  assert.ok(texts.includes('Solo plan'));
  assert.ok(texts.includes('For one engineer'));
});

// --- bug 4: multi-line JSX text ---------------------------------------------

test('a JSX text node whose words are on the next line is still extracted', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return (',
      '    <main>',
      '      <p>',
      '        Your deploy broke and nobody told you until Monday.',
      '      </p>',
      '    </main>',
      '  );',
      '}',
    ].join('\n'),
  });

  const { scan, result } = extract(dir);
  const found = scan.strings.find((s) => s.text.startsWith('Your deploy broke'));
  assert.ok(found, 'the string should be scanned');
  assert.equal(found.line, 5, 'the line reported is where the words are, not where the tag opens');
  assert.equal(result.skipped.length, 0, 'nothing should be refused');

  const out = fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8');
  assert.match(out, /\{t\('/, 'the text should have been replaced with a t() call');
  assert.doesNotMatch(out, /Your deploy broke/, 'the English should be gone from the component');
});

// --- bug 2: never write a file whose hook could not be wired ----------------

test('a concise arrow component gets a real body rather than an undefined t', () => {
  const dir = project({
    'app/b/page.tsx': [
      'const B = () => (',
      '  <h1>Nothing here yet, add your first project</h1>',
      ');',
      'export default B;',
    ].join('\n'),
  });

  extract(dir);
  const out = fs.readFileSync(path.join(dir, 'app/b/page.tsx'), 'utf8');
  assert.match(out, /useTranslations/, 'the hook must be imported');
  assert.match(out, /const t = useTranslations\(/, 'the hook must be declared');
  assert.match(out, /return \(/, 'the implicit return should have become explicit');
});

test('a file with no recognisable component is left completely untouched', () => {
  const before = [
    'export const rows = renderAll(',
    '  <h1>Nothing here yet, add your first project</h1>',
    ');',
  ].join('\n');
  const dir = project({ 'app/c/page.tsx': before });

  const { result } = extract(dir);
  const after = fs.readFileSync(path.join(dir, 'app/c/page.tsx'), 'utf8');

  if (result.applied.length === 0) {
    assert.equal(after, before, 'a file we cannot wire must not be half-rewritten');
    assert.doesNotMatch(after, /t\('/, 'never leave a call to a t that does not exist');
  } else {
    assert.match(after, /const t = useTranslations\(/, 'if we did rewrite it, the hook must be there');
  }
});

// --- bug 3: dedup regardless of quoting and spacing -------------------------

test('an existing hook is recognised through different quotes and spacing', () => {
  const dir = project({
    'app/c/page.tsx': [
      'import {useTranslations} from "next-intl";',
      'export default function C() {',
      '  const t = useTranslations("c");',
      '  return <h1>Pick a plan that fits</h1>;',
      '}',
    ].join('\n'),
  });

  extract(dir);
  const out = fs.readFileSync(path.join(dir, 'app/c/page.tsx'), 'utf8');

  assert.equal(out.match(/from ['"]next-intl['"]/g).length, 1, 'exactly one next-intl import');
  assert.equal(out.match(/const t = useTranslations/g).length, 1, 'exactly one t declaration');
  assert.match(out, /\{t\('pickPlanFits'\)\}/);
});

// --- bug 1: never silently discard the memory -------------------------------

test('a corrupt memory file is refused, not treated as an empty one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-mem-'));
  const file = path.join(dir, 'memory.json');

  fs.writeFileSync(file, '{"version":1, "entries": {', 'utf8');
  assert.throws(() => readJsonPrecious(file, { entries: {} }), /not valid JSON/);

  fs.writeFileSync(file, '<<<<<<< HEAD\n{"entries":{}}\n=======\n{"entries":{}}\n>>>>>>> b\n', 'utf8');
  assert.throws(() => readJsonPrecious(file, { entries: {} }), /conflict markers/);
});

test('an absent memory file still starts empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-mem-'));
  const memory = loadMemory(dir, 'en');
  assert.deepEqual(memory.entries, {});
});

test('loadMemory reads back what saveMemory wrote', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-mem-'));
  const memory = loadMemory(dir, 'en');
  memory.entries['common.hello'] = {
    source: 'Hello', sourceHash: 'x', namespace: 'common', kind: 'heading',
    file: 'a.tsx', placeholders: [], firstSeen: '', lastSeen: '', translations: {},
  };
  saveMemory(dir, memory);
  assert.deepEqual(Object.keys(loadMemory(dir, 'en').entries), ['common.hello']);
});

test('writeJson leaves no temp file behind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-w-'));
  writeJson(path.join(dir, 'a.json'), { a: 1 });
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
});

// --- bug 7: telling "deleted" apart from "already extracted" ----------------

test('a key the code still calls is not counted as dead', () => {
  const dir = project({
    'app/page.tsx': [
      "import { useTranslations } from 'next-intl';",
      'export default function Page() {',
      "  const t = useTranslations('common');",
      "  return <h1>{t('shipAfternoon')}</h1>;",
      '}',
    ].join('\n'),
  });

  const cfg = config();
  const used = scanKeyUsage(dir, cfg);
  assert.ok(used.has('shipAfternoon'), 'the leaf key should be seen in the code');

  const memory = emptyMemory();
  const entry = (source) => ({
    source, sourceHash: 'h', namespace: 'common', kind: 'heading',
    file: 'app/page.tsx', placeholders: [], firstSeen: '', lastSeen: '', translations: {},
  });
  memory.entries['common.shipAfternoon'] = entry('Ship it in an afternoon');
  memory.entries['common.deletedPage'] = entry('A page that was deleted');

  const dead = deadKeys(memory, cfg, used, new Set());
  assert.deepEqual(dead, ['common.deletedPage'], 'only the key nothing calls is dead');

  assert.deepEqual(pruneMemory(memory, dead), ['common.deletedPage']);
  assert.deepEqual(Object.keys(memory.entries), ['common.shipAfternoon']);
});

// --- apply must not wipe catalogues when memory is slimmed ------------------

test('apply with a slimmed memory overlays keys and keeps sibling catalogue copy', () => {
  const dir = project({});
  const cfg = config({
    layout: 'namespaced',
    locales: ['en', 'de'],
  });
  saveConfig(dir, cfg);

  writeCatalog(dir, cfg, 'en', {
    'dashboard.Dashboard.title': 'Dashboard',
    'dashboard.FinancialScore.title': 'Financial Score',
    'dashboard.newsFeed.title': 'News',
  });
  writeCatalog(dir, cfg, 'de', {
    'dashboard.Dashboard.title': 'Übersicht',
    'dashboard.FinancialScore.title': 'Finanzscore',
    'dashboard.newsFeed.title': 'Nachrichten',
  });

  // Agent-style slim memory: only the feature being translated.
  const memory = emptyMemory();
  memory.entries['dashboard.FinancialScore.title'] = {
    source: 'Financial Score',
    sourceHash: sha('Financial Score'),
    namespace: 'dashboard',
    kind: 'heading',
    file: 'app/score/page.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {},
  };
  saveMemory(dir, memory);

  applyDecisions(dir, memory, cfg, {
    'dashboard.FinancialScore.title:de': {
      key: 'dashboard.FinancialScore.title',
      locale: 'de',
      approved: true,
      value: 'Finanzgesundheit',
      editedByHuman: false,
    },
  });

  const en = readCatalog(dir, cfg, 'en');
  const de = readCatalog(dir, cfg, 'de');
  assert.equal(en['dashboard.Dashboard.title'], 'Dashboard');
  assert.equal(en['dashboard.newsFeed.title'], 'News');
  assert.equal(en['dashboard.FinancialScore.title'], 'Financial Score');
  assert.equal(de['dashboard.Dashboard.title'], 'Übersicht');
  assert.equal(de['dashboard.newsFeed.title'], 'Nachrichten');
  assert.equal(de['dashboard.FinancialScore.title'], 'Finanzgesundheit');
});

// --- bug 10: nested key collision -------------------------------------------

test('a key that is both a translation and a group is reported, not dropped', () => {
  assert.throws(() => nest({ 'a.b': 'x', 'a.b.c': 'y' }, 'nested'), /already a translation/);
  assert.throws(() => nest({ 'a.b.c': 'y', 'a.b': 'x' }, 'nested'), /already a group/);
  assert.deepEqual(nest({ 'a.b': 'x', 'a.b.c': 'y' }, 'flat'), { 'a.b': 'x', 'a.b.c': 'y' });
});

test('extraction writes renderable source fallbacks for every locale', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return <h1>Keep the app running while translations are reviewed</h1>;',
      '}',
    ].join('\n'),
  });
  const cfg = config();
  saveConfig(dir, cfg);

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readCatalog(dir, cfg, 'en'), {
    'common.keepAppRunningWhileTranslations': 'Keep the app running while translations are reviewed',
  });
  assert.deepEqual(readCatalog(dir, cfg, 'de'), {
    'common.keepAppRunningWhileTranslations': 'Keep the app running while translations are reviewed',
  });
});

test('source fallbacks remain untranslated work instead of becoming manual translations', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return <h1>Translate this after extraction</h1>;',
      '}',
    ].join('\n'),
  });
  saveConfig(dir, config());

  const extracted = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(extracted.status, 0, extracted.stderr);

  const translated = spawnSync(process.execPath, ['dist/cli.js', 'translate', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(translated.status, 0, translated.stderr);
  assert.match(translated.stdout, /1 item\(s\) need translating/);
  assert.doesNotMatch(translated.stdout, /nothing to translate/);
});

test('a catalogue write failure rolls back the whole extraction', () => {
  const before = [
    'export default function Page() {',
    '  return <h1>Do not leave this component half migrated</h1>;',
    '}',
  ].join('\n');
  const dir = project({
    'app/page.tsx': before,
    messages: 'this file deliberately blocks creation of messages/en.json',
  });
  saveConfig(dir, config());

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, '.language-loop/memory.json')), false);
  assert.equal(fs.existsSync(path.join(dir, '.language-loop/open-items.json')), false);
});

test('extracting new copy preserves edits made in the source catalogue', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return <h1>A newly added heading</h1>;',
      '}',
    ].join('\n'),
  });
  const cfg = config();
  saveConfig(dir, cfg);
  const memory = emptyMemory();
  memory.entries['common.existing'] = {
    source: 'Original heading',
    sourceHash: 'old-hash',
    namespace: 'common',
    kind: 'heading',
    file: 'app/old.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {},
  };
  saveMemory(dir, memory);
  fs.mkdirSync(path.join(dir, 'messages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'messages/en.json'), JSON.stringify({
    common: { existing: 'Edited by the copywriter' },
  }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const source = readCatalog(dir, cfg, 'en');
  assert.equal(source['common.existing'], 'Edited by the copywriter');
  assert.equal(source['common.newlyAddedHeading'], 'A newly added heading');
});

test('extraction falls back to current source copy instead of serving stale translations', () => {
  const dir = project({});
  const cfg = config();
  saveConfig(dir, cfg);
  const memory = emptyMemory();
  memory.entries['common.promise'] = {
    source: 'Ships in one day',
    sourceHash: 'old-hash',
    namespace: 'common',
    kind: 'body',
    file: 'app/page.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {
      de: {
        value: 'Versand an einem Tag',
        sourceHash: 'old-hash',
        status: 'approved',
        updatedAt: '',
        by: 'agent',
      },
    },
  };
  saveMemory(dir, memory);
  fs.mkdirSync(path.join(dir, 'messages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'messages/en.json'), JSON.stringify({
    common: { promise: 'Ships in three days' },
  }));
  fs.writeFileSync(path.join(dir, 'messages/de.json'), JSON.stringify({
    common: { promise: 'Versand an einem Tag' },
  }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readCatalog(dir, cfg, 'de')['common.promise'], 'Ships in three days');

  const translated = spawnSync(process.execPath, ['dist/cli.js', 'translate', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(translated.status, 0, translated.stderr);
  assert.match(translated.stdout, /1 item\(s\) need translating/);
});

test('editing source copy after extraction does not turn the old fallback into a manual translation', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return <h1>Original source heading</h1>;',
      '}',
    ].join('\n'),
  });
  const cfg = config();
  saveConfig(dir, cfg);

  const extracted = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(extracted.status, 0, extracted.stderr);

  const source = readCatalog(dir, cfg, 'en');
  source['common.originalSourceHeading'] = 'Revised source heading';
  fs.writeFileSync(path.join(dir, 'messages/en.json'), JSON.stringify({
    common: { originalSourceHeading: source['common.originalSourceHeading'] },
  }));

  const translated = spawnSync(process.execPath, ['dist/cli.js', 'translate', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(translated.status, 0, translated.stderr);
  assert.match(translated.stdout, /1 item\(s\) need translating/);
  assert.doesNotMatch(translated.stdout, /nothing to translate/);
});

test('extraction preserves existing catalogue keys that are not in loop memory', () => {
  const dir = project({
    'app/page.tsx': [
      "import { useTranslations } from 'next-intl';",
      'export default function Page() {',
      "  const t = useTranslations('common');",
      "  return <><h1>{t('legacy')}</h1><p>New hardcoded copy</p></>;",
      '}',
    ].join('\n'),
  });
  const cfg = config();
  saveConfig(dir, cfg);
  fs.mkdirSync(path.join(dir, 'messages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'messages/en.json'), JSON.stringify({
    common: { legacy: 'Existing source message' },
  }));
  fs.writeFileSync(path.join(dir, 'messages/de.json'), JSON.stringify({
    common: { legacy: 'Bestehende Übersetzung' },
  }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readCatalog(dir, cfg, 'en')['common.legacy'], 'Existing source message');
  assert.equal(readCatalog(dir, cfg, 'de')['common.legacy'], 'Bestehende Übersetzung');
});

test('a human can deliberately change a translation back to the source wording', () => {
  const dir = project({});
  const cfg = config();
  saveConfig(dir, cfg);
  const memory = emptyMemory();
  memory.entries['common.productName'] = {
    source: 'Language Loop',
    sourceHash: 'current-hash',
    namespace: 'common',
    kind: 'heading',
    file: 'app/page.tsx',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {
      de: {
        value: 'Sprachschleife',
        sourceHash: 'current-hash',
        status: 'approved',
        updatedAt: '',
        by: 'agent',
      },
    },
  };
  saveMemory(dir, memory);
  fs.mkdirSync(path.join(dir, 'messages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'messages/en.json'), JSON.stringify({
    common: { productName: 'Language Loop' },
  }));
  fs.writeFileSync(path.join(dir, 'messages/de.json'), JSON.stringify({
    common: { productName: 'Language Loop' },
  }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readCatalog(dir, cfg, 'de')['common.productName'], 'Language Loop');
  const saved = loadMemory(dir, 'en');
  assert.equal(saved.entries['common.productName'].translations.de.status, 'manual');
});

test('new extraction keys cannot collide with catalogue keys missing from memory', () => {
  const dir = project({
    'app/page.tsx': [
      'export default function Page() {',
      '  return <h1>New hardcoded copy</h1>;',
      '}',
    ].join('\n'),
  });
  const cfg = config();
  saveConfig(dir, cfg);
  fs.mkdirSync(path.join(dir, 'messages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'messages/en.json'), JSON.stringify({
    common: { newHardcodedCopy: 'Existing message under the generated slug' },
  }));
  fs.writeFileSync(path.join(dir, 'messages/de.json'), JSON.stringify({
    common: { newHardcodedCopy: 'Bestehende Nachricht' },
  }));

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const source = readCatalog(dir, cfg, 'en');
  const target = readCatalog(dir, cfg, 'de');
  assert.equal(source['common.newHardcodedCopy'], 'Existing message under the generated slug');
  assert.equal(target['common.newHardcodedCopy'], 'Bestehende Nachricht');
  assert.ok(Object.values(source).includes('New hardcoded copy'));
  assert.equal(Object.keys(source).length, 2);
});

test('staged translation freezes only the canonical marketing handoff key', () => {
  const dir = project({});
  const cfg = config();
  saveConfig(dir, cfg);
  fs.mkdirSync(path.join(dir, 'messages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'messages/en.json'), JSON.stringify({
    first: { submit: 'Submit' },
    second: { submit: 'Submit' },
  }));

  const memory = emptyMemory();
  for (const key of ['first.submit', 'second.submit']) {
    memory.entries[key] = {
      source: 'Submit',
      sourceHash: sha('Submit'),
      namespace: key.split('.')[0],
      kind: 'cta',
      file: 'src/App.tsx',
      placeholders: [],
      firstSeen: '',
      lastSeen: '',
      translations: {},
    };
  }
  saveMemory(dir, memory);
  fs.mkdirSync(path.join(dir, '.marketing-loop'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.marketing-loop/handoff.json'), JSON.stringify({
    schemaVersion: 1,
    marketingRunId: 'run',
    scopeDigest: '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5',
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    unresolved: [{
      key: 'first.submit',
      file: 'messages/en.json',
      sourceHash: '155f816c0407310c0dab222493370773e045ee7fe04e6c9a951b07f495531264',
      status: 'pending',
    }],
  }));

  const translated = spawnSync(process.execPath, ['dist/cli.js', 'translate', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(translated.status, 0, translated.stderr);
  const batch = JSON.parse(fs.readFileSync(path.join(dir, '.language-loop/batch.json'), 'utf8'));
  assert.deepEqual(batch.units.map((unit) => unit.key), ['second.submit']);
  const brief = fs.readFileSync(path.join(dir, '.language-loop/brief.md'), 'utf8');
  assert.match(brief, /`first\.submit` — “Submit”/);
  fs.rmSync(dir, { recursive: true, force: true });
});
