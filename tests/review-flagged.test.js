import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * `review --flagged` exists because nobody speaks nine languages, and a canvas
 * asking someone to approve 200 strings they cannot read is a rubber stamp.
 *
 * The danger it introduces is silent data loss: `apply` reads decisions.json
 * *instead of* auto-approving whenever that file exists, so a review that only
 * displays 3 of 200 units would have thrown the other 197 away. These tests
 * exist for that failure, not for the flag.
 */
function run(dir, args) {
  const result = spawnSync(process.execPath, ['dist/cli.js', ...args, '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-flagged-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { next: '14' } }));
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(
    path.join(dir, 'app', 'page.jsx'),
    'export default function P(){return <div><h1>Welcome back</h1>' +
      '<button>Get started free</button><p>Your dashboard is ready</p></div>}'
  );

  run(dir, ['init', '--source', 'en-US', '--locales', 'de-DE,ru-RU', '--agents', 'claude']);
  run(dir, ['scan']);
  run(dir, ['extract']);
  run(dir, ['translate']);

  // One item carries a translator note, so exactly one is worth a human's time.
  const memory = JSON.parse(fs.readFileSync(path.join(dir, '.language-loop', 'memory.json'), 'utf8'));
  const translations = [];
  let first = true;
  for (const [key, entry] of Object.entries(memory.entries)) {
    for (const locale of ['de-DE', 'ru-RU']) {
      translations.push({
        key,
        locale,
        value: `X ${entry.source}`,
        ...(first ? { note: 'judgement call: shortened to fit the button' } : {}),
      });
      first = false;
    }
  }
  fs.writeFileSync(
    path.join(dir, '.language-loop', 'translations.json'),
    JSON.stringify({ translations }, null, 2)
  );
  return { dir, total: translations.length };
}

test('--flagged shows only what needs a decision', () => {
  const { dir, total } = project();
  const out = run(dir, ['review', '--flagged']);
  assert.match(out, /showing 1 that need a decision/);
  assert.match(out, new RegExp(`the other ${total - 1} are guardrail-clean`));
});

test('--flagged carries the unshown translations through to the catalogues', () => {
  const { dir, total } = project();
  run(dir, ['review', '--flagged']);

  // The remainder is banked before the human touches anything, so an abandoned
  // review cannot lose it either.
  const decisions = JSON.parse(fs.readFileSync(path.join(dir, '.language-loop', 'decisions.json'), 'utf8'));
  assert.equal(Object.keys(decisions).length, total - 1);
  assert.ok(Object.values(decisions).every((d) => d.approved));

  const reviewFile = path.join(dir, '.language-loop', 'review.md');
  fs.writeFileSync(reviewFile, fs.readFileSync(reviewFile, 'utf8').replaceAll('- [ ]', '- [x]'));
  run(dir, ['review', '--collect']);
  const applied = run(dir, ['apply']);

  assert.match(applied, new RegExp(`${total} guardrail-clean translation\\(s\\) written`));

  const de = JSON.parse(fs.readFileSync(path.join(dir, 'messages', 'de-DE.json'), 'utf8'));
  const ru = JSON.parse(fs.readFileSync(path.join(dir, 'messages', 'ru-RU.json'), 'utf8'));
  const translated = (o) => (JSON.stringify(o).match(/"X /g) ?? []).length;
  assert.equal(translated(de) + translated(ru), total, 'every translation must reach a catalogue');
});

test('a full review is unaffected and still shows everything', () => {
  const { dir, total } = project();
  const out = run(dir, ['review']);
  assert.match(out, new RegExp(`${total} ready for you`));
  assert.doesNotMatch(out, /need a decision/);

  // Without --flagged nothing is banked early; apply's own auto-approval covers it.
  assert.ok(!fs.existsSync(path.join(dir, '.language-loop', 'decisions.json')));
});
