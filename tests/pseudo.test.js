import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  pseudoCatalog,
  pseudolocalize,
  protectedMessageTokens,
} from '../dist/core/pseudo.js';
import { readCatalog, writeCatalog } from '../dist/core/catalog.js';
import { defaultConfig, saveConfig } from '../dist/core/config.js';

const MESSAGE =
  'Hello <strong>{name}</strong>, you have {count, plural, =0 {no files} one {# file} other {# files}}. ' +
  'Use {{product}} or %1$s.\\nContinue';

test('en-XA pseudolocalization expands visible copy without changing message syntax', () => {
  const result = pseudolocalize(MESSAGE, 'en-XA');

  assert.notEqual(result, MESSAGE);
  assert.ok(result.length > MESSAGE.length * 1.25);
  assert.match(result, /Ḩ|ë|ļ|ö/);
  assert.deepEqual(protectedMessageTokens(result), protectedMessageTokens(MESSAGE));
  assert.equal((result.match(/\\n/g) ?? []).length, 1);
});

test('ar-XB pseudolocalization mirrors visible copy and keeps protected tokens intact', () => {
  const result = pseudolocalize(MESSAGE, 'ar-XB');

  assert.notEqual(result, MESSAGE);
  assert.ok(result.startsWith('\u2067'));
  assert.ok(result.endsWith('\u2069'));
  assert.deepEqual(protectedMessageTokens(result), protectedMessageTokens(MESSAGE));
});

test('pseudolocalization preserves newlines and supports whole catalogues', () => {
  const source = {
    'home.title': 'Welcome home',
    'home.body': 'First line\nSecond line',
  };

  const result = pseudoCatalog(source, 'en-XA');
  assert.deepEqual(Object.keys(result), Object.keys(source));
  assert.notEqual(result['home.title'], source['home.title']);
  assert.equal(
    result['home.body'].split('\n').length,
    source['home.body'].split('\n').length
  );
});

test('pseudolocalization refuses unsupported pseudo-locales', () => {
  assert.throws(() => pseudolocalize('Hello', 'de-DE'), /en-XA.*ar-XB/i);
});

test('pseudo CLI writes both pseudo-locale catalogues from the source catalogue', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'language-loop-pseudo-'));
  const config = {
    ...defaultConfig({
      framework: 'react',
      runtime: 'plain',
      messagesDir: 'messages',
      layout: 'single-file',
      srcDir: 'src',
      runtimeInstalled: true,
      evidence: [],
    }),
    sourceLocale: 'en-US',
    locales: ['de-DE'],
  };
  saveConfig(root, config);
  writeCatalog(root, config, 'en-US', { 'home.greeting': 'Hello {name}' });

  const run = spawnSync(
    process.execPath,
    ['dist/cli.js', 'pseudo', '--cwd', root],
    { cwd: process.cwd(), encoding: 'utf8' }
  );

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /en-XA/);
  assert.match(run.stdout, /ar-XB/);
  assert.match(readCatalog(root, config, 'en-XA')['home.greeting'], /\{name\}/);
  assert.match(readCatalog(root, config, 'ar-XB')['home.greeting'], /\{name\}/);
});
