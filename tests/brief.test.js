import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defaultConfig } from '../dist/core/config.js';
import { writeBrief } from '../dist/core/brief.js';

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

  const result = writeBrief(dir, {
    config,
    memory: { version: 1, sourceLocale: 'en-US', updatedAt: '', entries: {} },
    work: [{
      key: 'hero.getStarted',
      locale: 'pt-BR',
      source: 'Get started',
      kind: 'cta',
      file: 'src/Hero.tsx',
      placeholders: [],
      reason: 'new',
    }],
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
  assert.match(brief, /\/i18n-review/);
  assert.match(brief, /\/language-loop apply/);
  assert.doesNotMatch(brief, /npx language-loop review --ui/);
});
