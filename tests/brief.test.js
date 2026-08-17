import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defaultConfig } from '../dist/core/config.js';
import { writeBrief } from '../dist/core/brief.js';
import { createBatch } from '../dist/core/batch.js';

test('translation brief asks for natural audience-locale product language', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-brief-'));
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
    locales: ['en-US', 'pt-BR'],
    agents: ['cursor'],
  };

  const work = [{
    key: 'hero.getStarted',
    locale: 'pt-BR',
    source: 'Get started',
    kind: 'cta',
    file: 'src/Hero.tsx',
    placeholders: [],
    reason: 'new',
  }];
  const result = writeBrief(dir, {
    config,
    memory: { version: 1, sourceLocale: 'en-US', updatedAt: '', entries: {} },
    work,
    batch: createBatch(work, { id: 'brief-batch', sourceLocale: 'en-US' }),
    marketing: {
      installed: false,
      hasRun: false,
      pendingTexts: [],
    },
    openItems: [],
    frozen: [],
  });
  const brief = fs.readFileSync(path.join(dir, result.file), 'utf8');

  assert.match(brief, /Brazilian Portuguese/);
  assert.match(brief, /native user would expect in a modern app/i);
  assert.match(brief, /avoid textbook, bureaucratic, or overly formal/i);
  assert.match(brief, /Brazilian Portuguese vocabulary and spelling/i);
  assert.match(brief, /\/language-loop judge/);
  assert.match(brief, /Language swarm/);
  assert.match(brief, /pt-BR-specialist/);
  assert.doesNotMatch(brief, /i18n-review|review --ui|human approves/i);
});

test('translation brief lists one specialist per pending language', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-brief-swarm-'));
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
    sourceLocale: 'en',
    locales: ['en', 'de-DE', 'ru-RU', 'fr-FR'],
  };
  const work = [{
    key: 'hero.getStarted',
    locale: 'de-DE',
    source: 'Get started',
    kind: 'cta',
    file: 'src/Hero.tsx',
    placeholders: [],
    reason: 'new',
  }];
  const result = writeBrief(dir, {
    config,
    memory: { version: 1, sourceLocale: 'en', updatedAt: '', entries: {} },
    work,
    batch: createBatch(work, { id: 'swarm-batch', sourceLocale: 'en' }),
    marketing: { installed: false, hasRun: false, pendingTexts: [] },
    openItems: [],
    frozen: [],
    swarmLocales: ['de-DE', 'ru-RU', 'fr-FR'],
  });
  const brief = fs.readFileSync(path.join(dir, result.file), 'utf8');

  assert.match(brief, /3 sub-agents which are\nspecialists on the specific language/i);
  assert.match(brief, /`de-DE-specialist` — German[^\n]*\(`de-DE`/);
  assert.match(brief, /owns this brief/);
  assert.match(brief, /`ru-RU-specialist` — Russian[^\n]*\(`ru-RU`/);
  assert.match(brief, /`fr-FR-specialist` — French[^\n]*\(`fr-FR`/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('translation brief names exact marketing-frozen keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-brief-'));
  const config = {
    ...defaultConfig({
      framework: 'react',
      runtime: 'react-i18next',
      messagesDir: 'messages',
      layout: 'single-file',
      srcDir: 'src',
      runtimeInstalled: true,
      evidence: [],
    }),
    sourceLocale: 'en',
    locales: ['en', 'de'],
  };
  const frozen = [{
    key: 'hero.getStarted',
    locale: 'de',
    source: 'Get started',
    kind: 'cta',
    file: 'src/Hero.tsx',
    placeholders: [],
    reason: 'new',
  }];
  const work = [{
    key: 'hero.ready',
    locale: 'de',
    source: 'Ready',
    kind: 'cta',
    file: 'src/Hero.tsx',
    placeholders: [],
    reason: 'new',
  }];
  const result = writeBrief(dir, {
    config,
    memory: { version: 1, sourceLocale: 'en', updatedAt: '', entries: {} },
    work,
    batch: createBatch(work, { id: 'brief-with-frozen', sourceLocale: 'en' }),
    marketing: { installed: true, hasRun: true, pendingTexts: [] },
    openItems: [],
    frozen,
  });
  const brief = fs.readFileSync(path.join(dir, result.file), 'utf8');

  assert.match(brief, /^- `hero\.getStarted` — “Get started”$/m);
  assert.match(brief, /marketing-loop has an unresolved rewrite/);
  fs.rmSync(dir, { recursive: true, force: true });
});
