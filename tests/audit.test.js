import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { defaultConfig, saveConfig } from '../dist/core/config.js';

function project(agent, hardcoded = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-audit-'));
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
    sourceLocale: 'en-US',
    locales: ['en-US', 'de-DE'],
    agents: [agent],
  };
  saveConfig(dir, config);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src/App.tsx'),
    hardcoded
      ? 'export function App() { return <h1>Still hardcoded copy</h1>; }\n'
      : 'export function App() { return null; }\n'
  );
  return dir;
}

function files(dir) {
  const result = {};
  const visit = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(full);
      else result[path.relative(dir, full)] = fs.readFileSync(full).toString('base64');
    }
  };
  visit(dir);
  return result;
}

function audit(dir) {
  return spawnSync(process.execPath, ['dist/cli.js', 'audit', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

test('Cursor audit reports findings and slash-command fixes without writing', () => {
  const dir = project('cursor');
  const before = files(dir);
  const run = audit(dir);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /language completeness/i);
  assert.match(run.stdout, /hardcoded/i);
  assert.match(run.stdout, /\/language-loop extract/);
  assert.doesNotMatch(run.stdout, /npx language-loop extract/);
  assert.deepEqual(files(dir), before);
});

test('terminal audit recommends terminal commands', () => {
  const run = audit(project('codex'));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /npx language-loop extract/);
});

test('clean audit prints complete and no speculative next steps', () => {
  const run = audit(project('cursor', false));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /complete/i);
  assert.doesNotMatch(run.stdout, /next steps/i);
});
