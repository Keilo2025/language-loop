import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { Backup } from '../dist/core/backup.js';
import { ensureGitignore, GITIGNORE_ENTRIES } from '../dist/core/gitignore.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'll-gitignore-'));
}

test('ensureGitignore creates .gitignore with backups and backlog', () => {
  const dir = tmp();
  const added = ensureGitignore(dir);
  assert.deepEqual(added, [...GITIGNORE_ENTRIES]);
  const text = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(text, /^\*\*\/\.language-loop\/backups\/$/m);
  assert.match(text, /^\*\*\/\.language-loop\/backlog\/$/m);
});

test('ensureGitignore appends missing entries and leaves existing lines alone', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.DS_Store');
  const added = ensureGitignore(dir);
  assert.deepEqual(added, [...GITIGNORE_ENTRIES]);
  const text = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(text, /^node_modules\/$/m);
  assert.match(text, /^\.DS_Store$/m);
  assert.match(text, /^\*\*\/\.language-loop\/backups\/$/m);
  assert.match(text, /^\*\*\/\.language-loop\/backlog\/$/m);
});

test('ensureGitignore is a no-op when both entries already exist', () => {
  const dir = tmp();
  const original = '**/.language-loop/backups/\n**/.language-loop/backlog/\n';
  fs.writeFileSync(path.join(dir, '.gitignore'), original);
  assert.deepEqual(ensureGitignore(dir), []);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), original);
});

test('ensureGitignore treats a slashless twin as already present', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.gitignore'), '**/.language-loop/backups\n');
  const added = ensureGitignore(dir);
  assert.deepEqual(added, ['**/.language-loop/backlog/']);
});

test('init writes the default language-loop gitignore entries', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't' }));
  const run = spawnSync(process.execPath, [
    'dist/cli.js', 'init', '--cwd', dir,
    '--source', 'en-US', '--locales', 'de-DE', '--agents', 'cursor',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const text = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(text, /^\*\*\/\.language-loop\/backups\/$/m);
  assert.match(text, /^\*\*\/\.language-loop\/backlog\/$/m);
  assert.match(run.stdout, /\.gitignore/);
});

test('committing a backup also ensures the gitignore entries', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'messages.json'), '{}\n');
  const backup = new Backup(dir, 'extract');
  backup.capture('messages.json');
  assert.ok(backup.commit());
  const text = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(text, /^\*\*\/\.language-loop\/backups\/$/m);
  assert.match(text, /^\*\*\/\.language-loop\/backlog\/$/m);
});
