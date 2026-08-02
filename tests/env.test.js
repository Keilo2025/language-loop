import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDotEnv, loadDotEnv } from '../dist/core/env.js';

function tempProject(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-loop-env-'));
  if (content !== undefined) fs.writeFileSync(path.join(dir, '.env'), content);
  return dir;
}

test('parses plain, exported, quoted and commented lines', () => {
  const parsed = parseDotEnv([
    '# a comment',
    '',
    'OPENAI_API_KEY=sk-123',
    'export GOOGLE_CLOUD_PROJECT=my-project',
    'QUOTED="hello world"',
    "SINGLE='literal # not a comment'",
    'EMPTY=',
    'SPACED = value with spaces ',
    'not a variable line',
  ].join('\n'));
  assert.equal(parsed.OPENAI_API_KEY, 'sk-123');
  assert.equal(parsed.GOOGLE_CLOUD_PROJECT, 'my-project');
  assert.equal(parsed.QUOTED, 'hello world');
  assert.equal(parsed.SINGLE, 'literal # not a comment');
  assert.equal(parsed.EMPTY, '');
  assert.equal(parsed.SPACED, 'value with spaces');
  assert.equal('not a variable line' in parsed, false);
});

test('double quotes expand escapes, single quotes stay literal', () => {
  const parsed = parseDotEnv('A="line1\\nline2"\nB=\'line1\\nline2\'');
  assert.equal(parsed.A, 'line1\nline2');
  assert.equal(parsed.B, 'line1\\nline2');
});

test('inline comments are stripped from unquoted values only', () => {
  const parsed = parseDotEnv('A=value # trailing comment\nB="value # kept"\nC=value#not-comment');
  assert.equal(parsed.A, 'value');
  assert.equal(parsed.B, 'value # kept');
  assert.equal(parsed.C, 'value#not-comment');
});

test('loadDotEnv applies missing variables and never overrides existing ones', () => {
  const dir = tempProject('OPENAI_API_KEY=from-file\nGOOGLE_CLOUD_PROJECT=from-file\n');
  const env = { OPENAI_API_KEY: 'from-shell' };
  const result = loadDotEnv(dir, env);
  assert.equal(env.OPENAI_API_KEY, 'from-shell');
  assert.equal(env.GOOGLE_CLOUD_PROJECT, 'from-file');
  assert.deepEqual(result.keys, ['GOOGLE_CLOUD_PROJECT']);
});

test('loadDotEnv returns null when the project has no .env', () => {
  const dir = tempProject(undefined);
  const env = {};
  assert.equal(loadDotEnv(dir, env), null);
  assert.deepEqual(env, {});
});

test('an empty .env loads nothing but is not an error', () => {
  const dir = tempProject('# only comments\n\n');
  const result = loadDotEnv(dir, {});
  assert.deepEqual(result.keys, []);
});
