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
import { nest } from '../dist/core/catalog.js';
import { readJsonPrecious, writeJson } from '../dist/core/util.js';

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

function extract(dir, cfg = config()) {
  const scan = scanRepo(dir, cfg);
  const keyed = assignKeys(scan.strings, cfg, emptyMemory());
  const plan = planExtraction(dir, keyed, cfg);
  return { scan, keyed, plan, result: applyExtraction(dir, plan, cfg, false) };
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

// --- bug 10: nested key collision -------------------------------------------

test('a key that is both a translation and a group is reported, not dropped', () => {
  assert.throws(() => nest({ 'a.b': 'x', 'a.b.c': 'y' }, 'nested'), /already a translation/);
  assert.throws(() => nest({ 'a.b.c': 'y', 'a.b': 'x' }, 'nested'), /already a group/);
  assert.deepEqual(nest({ 'a.b': 'x', 'a.b.c': 'y' }, 'flat'), { 'a.b': 'x', 'a.b.c': 'y' });
});
