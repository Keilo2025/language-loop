import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * The judge closes the loop: translate -> judge -> apply -> back to translate
 * for anything rejected, until the AI judge approves it.
 *
 * The user is not a fallback reviewer: they usually asked for these languages
 * precisely because they cannot read them. A rejection must therefore remain
 * autonomous and visible to the next translation pass.
 */
function run(dir, args) {
  const result = spawnSync(process.execPath, ['dist/cli.js', ...args, '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

const statePath = (dir, file) => path.join(dir, '.language-loop', file);
const readMemory = (dir) => JSON.parse(fs.readFileSync(statePath(dir, 'memory.json'), 'utf8'));

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-judge-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { next: '14' } }));
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(
    path.join(dir, 'app', 'page.jsx'),
    'export default function P(){return <div><h1>Welcome back</h1><button>Get started free</button></div>}'
  );
  run(dir, ['init', '--source', 'en-US', '--locales', 'de-DE', '--agents', 'claude']);
  run(dir, ['scan']);
  run(dir, ['extract']);
  run(dir, ['translate']);
  return dir;
}

/** Translate everything outstanding, then reject the first and pass the rest. */
function submitAndJudge(dir, label, { rejectFirst = true } = {}) {
  const memory = readMemory(dir);
  const translations = [];
  for (const [key, entry] of Object.entries(memory.entries)) {
    const existing = entry.translations['de-DE'];
    if (!existing || existing.status === 'rework') {
      translations.push({ key, locale: 'de-DE', value: `DE ${label} ${entry.source}` });
    }
  }
  fs.writeFileSync(statePath(dir, 'translations.json'), JSON.stringify({ translations }, null, 2));
  fs.writeFileSync(
    statePath(dir, 'verdicts.json'),
    JSON.stringify({
      verdicts: translations.map((t, i) => ({
        key: t.key,
        locale: t.locale,
        ok: !(rejectFirst && i === 0),
        ...(rejectFirst && i === 0 ? { reason: 'says the opposite of the English' } : {}),
      })),
    })
  );
  return translations.length;
}

test('the judge only sees what the guardrails could not decide', () => {
  const dir = project();
  const memory = readMemory(dir);
  const translations = Object.entries(memory.entries).map(([key], i) => ({
    key,
    locale: 'de-DE',
    // The first drops nothing; the second is empty, which the rules block.
    value: i === 0 ? 'Willkommen zurück' : '',
  }));
  fs.writeFileSync(statePath(dir, 'translations.json'), JSON.stringify({ translations }, null, 2));

  const out = run(dir, ['judge']);
  assert.match(out, /1 already rejected by the guardrails/);
  assert.match(out, /1 need a verdict/);

  const brief = fs.readFileSync(statePath(dir, 'judge.md'), 'utf8');
  assert.match(brief, /Willkommen zurück/);
});

test('a rejected translation never reaches the catalogue', () => {
  const dir = project();
  submitAndJudge(dir, 'one');
  run(dir, ['apply']);

  const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'messages', 'de-DE.json'), 'utf8'));
  const flat = JSON.stringify(catalog);
  assert.ok(flat.includes('DE one Get started free'), 'the passing translation should be written');
  assert.ok(!flat.includes('DE one Welcome back'), 'the rejected translation must not be written');
});

test('a rejection comes back round carrying the reason it failed', () => {
  const dir = project();
  submitAndJudge(dir, 'one');
  run(dir, ['apply']);

  const out = run(dir, ['translate']);
  assert.match(out, /1 item\(s\) need translating/);

  const brief = fs.readFileSync(statePath(dir, 'brief.md'), 'utf8');
  assert.match(brief, /rejected attempt 1/);
  assert.match(brief, /says the opposite of the English/);
  assert.match(brief, /Do not merely rephrase/);
});

test('repeated judge rejections stay in the autonomous loop instead of asking the user to approve', () => {
  const dir = project();
  for (let attempt = 1; attempt <= 3; attempt++) {
    submitAndJudge(dir, `try${attempt}`);
    run(dir, ['apply']);
  }

  const out = run(dir, ['translate']);
  assert.match(out, /1 item\(s\) need translating/);

  const memory = readMemory(dir);
  const rework = Object.values(memory.entries).filter(
    (entry) => entry.translations['de-DE']?.status === 'rework'
  );
  assert.equal(rework.length, 1);
  assert.equal(rework[0].translations['de-DE'].attempts, 3);

  const status = run(dir, ['status']);
  assert.match(status, /sent back by the judge/);
  assert.doesNotMatch(status, /need a human|waiting on a person|approval/i);
});

test('new English resets the autonomous judge history', () => {
  const dir = project();
  for (let attempt = 1; attempt <= 3; attempt++) {
    submitAndJudge(dir, `try${attempt}`);
    run(dir, ['apply']);
  }

  // Rewrite the English of the stuck key. It failed against wording that no
  // longer exists, so holding the old verdict against it would strand it.
  const source = path.join(dir, 'messages', 'en-US.json');
  const catalog = JSON.parse(fs.readFileSync(source, 'utf8'));
  catalog.common.welcomeBack = 'Good to see you again';
  fs.writeFileSync(source, JSON.stringify(catalog, null, 2));

  run(dir, ['translate']);
  const memory = readMemory(dir);
  const revived = memory.entries['common.welcomeBack'].translations['de-DE'];
  assert.equal(revived.status, 'stale');
  assert.equal(revived.attempts, undefined, 'the attempt count must reset with new English');
});

test('apply without verdicts behaves exactly as it did before the judge existed', () => {
  const dir = project();
  const memory = readMemory(dir);
  const translations = Object.entries(memory.entries).map(([key, entry]) => ({
    key,
    locale: 'de-DE',
    value: `DE ${entry.source}`,
  }));
  fs.writeFileSync(statePath(dir, 'translations.json'), JSON.stringify({ translations }, null, 2));

  const out = run(dir, ['apply']);
  assert.match(out, /2 guardrail-clean translation\(s\) written/);
  assert.doesNotMatch(out, /sent back/);
  assert.doesNotMatch(out, /stopped looping/);
});
