import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractComponentContext } from '../dist/core/context.js';

test('component context is bounded, redacted, and includes nearby keys', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'll-context-'));
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'src', 'Hero.tsx'), [
    'const apiKey = "should-not-leak";',
    'export function Hero() {',
    '  const title = t("hero.title");',
    '  return <button>{t("hero.cta")}</button>;',
    '}',
    ...Array.from({ length: 30 }, (_, i) => `// filler ${i}`),
  ].join('\n'));
  const memory = {
    version: 1,
    sourceLocale: 'en',
    updatedAt: '',
    entries: {
      'hero.cta': {
        source: 'Start free',
        sourceHash: 'a',
        namespace: 'hero',
        kind: 'cta',
        file: 'src/Hero.tsx',
        line: 4,
        component: 'Hero',
        placeholders: [],
        firstSeen: '',
        lastSeen: '',
        translations: {},
      },
      'hero.title': {
        source: 'Welcome',
        sourceHash: 'b',
        namespace: 'hero',
        kind: 'heading',
        file: 'src/Hero.tsx',
        line: 3,
        component: 'Hero',
        placeholders: [],
        firstSeen: '',
        lastSeen: '',
        translations: {},
      },
    },
  };

  const context = extractComponentContext(cwd, 'hero.cta', 'de-DE', memory, {
    radius: 10,
    maxChars: 240,
  });
  assert.equal(context.file, 'src/Hero.tsx');
  assert.equal(context.component, 'Hero');
  assert.ok(context.excerpt.length <= 240);
  assert.doesNotMatch(context.excerpt, /should-not-leak/);
  assert.match(context.excerpt, /\[REDACTED\]/);
  assert.deepEqual(context.neighborKeys, ['hero.title']);
  assert.match(context.hash, /^[a-f0-9]{16}$/);

  const again = extractComponentContext(cwd, 'hero.cta', 'de-DE', memory, {
    radius: 10,
    maxChars: 240,
  });
  assert.equal(again.hash, context.hash);
});

test('component context refuses source symlinks that escape the project', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'll-context-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'll-context-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.tsx'), 'export const password = "secret";');
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.symlinkSync(path.join(outside, 'secret.tsx'), path.join(cwd, 'src', 'Hero.tsx'));
  const memory = {
    version: 1,
    sourceLocale: 'en',
    updatedAt: '',
    entries: {
      key: {
        source: 'Hello',
        sourceHash: 'hash',
        namespace: 'common',
        kind: 'body',
        file: 'src/Hero.tsx',
        line: 1,
        placeholders: [],
        firstSeen: '',
        lastSeen: '',
        translations: {},
      },
    },
  };
  assert.throws(
    () => extractComponentContext(cwd, 'key', 'de-DE', memory),
    /outside the project|escapes/i
  );
});
