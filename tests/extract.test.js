import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { scanRepo } from '../dist/core/scan.js';
import { assignKeys } from '../dist/core/keys.js';
import { planExtraction, applyExtraction } from '../dist/core/extract.js';
import { defaultConfig, saveConfig } from '../dist/core/config.js';
import { detect } from '../dist/core/detect.js';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-loop-'));
  fs.cpSync('tests/fixture', dir, { recursive: true });
  return dir;
}

function setup(dir) {
  const config = { ...defaultConfig(detect(dir)), locales: ['en', 'de'] };
  const memory = { version: 1, sourceLocale: 'en', updatedAt: '', entries: {} };
  const scan = scanRepo(dir, config);
  const keyed = assignKeys(scan.strings, config, memory);
  return { config, memory, keyed };
}

test('detects a next-intl app router project from its dependencies', () => {
  const detection = detect('tests/fixture');
  assert.equal(detection.framework, 'next-app');
  assert.equal(detection.runtime, 'next-intl');
  assert.equal(detection.runtimeInstalled, true);
});

test('rewrites jsx text and attributes, and adds the hook once', () => {
  const dir = sandbox();
  const { config, keyed } = setup(dir);
  const plan = planExtraction(dir, keyed, config);
  applyExtraction(dir, plan, config);

  const hero = fs.readFileSync(path.join(dir, 'components/Hero.tsx'), 'utf8');
  assert.match(hero, /import \{ useTranslations \} from 'next-intl';/);
  assert.equal(hero.match(/useTranslations\('hero'\)/g).length, 1);
  assert.match(hero, /<h1>\{t\('findOutYourDeployBroke'\)\}<\/h1>/);
  assert.match(hero, /aria-label=\{t\('yourWorkEmailAddress'\)\}/);
  assert.match(hero, /alt=\{t\('dashboardShowingFourFailingDeploys'\)\}/);

  // Untouched: not copy.
  assert.match(hero, /type="email"/);
  assert.match(hero, /data-size=\{size\}/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses a literal declared outside any component', () => {
  const dir = sandbox();
  const { config, keyed } = setup(dir);
  const plan = planExtraction(dir, keyed, config);

  const refused = plan.openItems.filter((i) => i.reason.includes('outside any component'));
  assert.ok(refused.some((i) => i.text === 'Solo'));

  applyExtraction(dir, plan, config);
  const pricing = fs.readFileSync(path.join(dir, 'app/pricing/page.tsx'), 'utf8');
  assert.match(pricing, /title: 'Solo'/, 'the module-scope literal must be left exactly as it was');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hands interpolated sentences to the agent rather than guessing', () => {
  const dir = sandbox();
  const { config, keyed } = setup(dir);
  const plan = planExtraction(dir, keyed, config);
  assert.ok(plan.openItems.some((i) => i.text.startsWith('You have') && i.reason.includes('{count}')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a second pass over already-extracted code changes nothing', () => {
  const dir = sandbox();
  const { config, memory, keyed } = setup(dir);
  applyExtraction(dir, planExtraction(dir, keyed, config), config);
  const after = fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8');

  const rescan = scanRepo(dir, config);
  const rekeyed = assignKeys(rescan.strings, config, memory);
  applyExtraction(dir, planExtraction(dir, rekeyed, config), config);

  assert.equal(fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8'), after);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a dry run writes nothing', () => {
  const dir = sandbox();
  const { config, keyed } = setup(dir);
  const before = fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8');
  applyExtraction(dir, planExtraction(dir, keyed, config), config, true);
  assert.equal(fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('legacy marketing proposal text never prevents hardcoded text extraction', () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, '.marketing-loop'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.marketing-loop/proposals.json'),
    JSON.stringify({
      schemaVersion: 4,
      proposals: [{ before: 'Get started free', status: 'pending' }],
    })
  );
  const { config } = setup(dir);
  saveConfig(dir, config);

  const run = spawnSync(process.execPath, ['dist/cli.js', 'extract', '--cwd', dir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const page = fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8');
  assert.doesNotMatch(page, />Get started free</);
  assert.match(page, /t\('getStartedFree'\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});
