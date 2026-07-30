import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig } from '../dist/core/config.js';
import {
  detectMarketingLoop,
  frozenTexts,
  inspectMarketingHandoff,
  requireMarketingKeys,
} from '../dist/core/marketing.js';
import { sha } from '../dist/core/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCOPE_DIGEST = '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5';
const SUBMIT_SHA256 = '155f816c0407310c0dab222493370773e045ee7fe04e6c9a951b07f495531264';

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-marketing-'));
  fs.mkdirSync(path.join(cwd, 'messages'));
  fs.mkdirSync(path.join(cwd, '.marketing-loop'));
  fs.writeFileSync(path.join(cwd, 'messages/en.json'), JSON.stringify({
    first: { submit: 'Submit' },
    second: { submit: 'Submit' },
  }));
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
  const memory = {
    version: 1,
    sourceLocale: 'en',
    updatedAt: '',
    entries: Object.fromEntries(['first.submit', 'second.submit'].map((key) => [key, {
      source: 'Submit',
      sourceHash: sha('Submit'),
      namespace: key.split('.')[0],
      kind: 'cta',
      file: 'src/App.tsx',
      placeholders: [],
      firstSeen: '',
      lastSeen: '',
      translations: {},
    }])),
  };
  return { cwd, config, memory };
}

function writeHandoff(cwd, handoff) {
  fs.writeFileSync(
    path.join(cwd, '.marketing-loop/handoff.json'),
    JSON.stringify(handoff),
  );
}

function validHandoff() {
  return {
    schemaVersion: 1,
    marketingRunId: 'run',
    scopeDigest: SCOPE_DIGEST,
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    unresolved: [{
      key: 'first.submit',
      file: 'messages/en.json',
      sourceHash: SUBMIT_SHA256,
      status: 'pending',
    }],
  };
}

test('handoff consumer matches the versioned contract fixture', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-contract-'));
  fs.mkdirSync(path.join(cwd, 'messages'));
  fs.mkdirSync(path.join(cwd, '.marketing-loop'));
  fs.writeFileSync(path.join(cwd, 'messages/en.json'), JSON.stringify({
    hero: { startFree: 'Start free' },
  }));
  const handoff = fs.readFileSync(
    path.join(here, 'contracts/marketing-handoff-v1.json'),
    'utf8',
  );
  fs.writeFileSync(path.join(cwd, '.marketing-loop/handoff.json'), handoff);
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
  const memory = {
    version: 1,
    sourceLocale: 'en',
    updatedAt: '',
    entries: {
      'hero.startFree': {
        source: 'Start free',
        sourceHash: sha('Start free'),
        namespace: 'hero',
        kind: 'cta',
        file: 'src/Hero.tsx',
        placeholders: [],
        firstSeen: '',
        lastSeen: '',
        translations: {},
      },
    },
  };

  assert.deepEqual([...requireMarketingKeys(cwd, config, memory)], ['hero.startFree']);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('handoff freezes one canonical key without freezing identical text', () => {
  const { cwd, config, memory } = fixture();
  writeHandoff(cwd, validHandoff());

  const keys = requireMarketingKeys(cwd, config, memory);

  assert.deepEqual([...keys], ['first.submit']);
  assert.equal(keys.has('second.submit'), false);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('schema-v1 handoff accepts and normalizes an authoritative Content Loop selection', () => {
  const { cwd, config, memory } = fixture();
  const handoff = validHandoff();
  handoff.selection = {
    filter: { keys: ['first.submit'] },
    resolvedKeys: ['first.submit'],
    targetLocales: ['de'],
  };
  writeHandoff(cwd, handoff);

  const state = inspectMarketingHandoff(cwd, config, memory);

  assert.equal(state.compatible, true);
  assert.deepEqual(state.selection, {
    filter: {
      categories: [],
      groups: [],
      keys: ['first.submit'],
    },
    resolvedKeys: ['first.submit'],
    targetLocales: ['de'],
  });
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('Content Loop handoff selection fails closed on filter, key, locale, and duplicate mismatches', () => {
  const cases = [
    [
      'resolved filter',
      {
        filter: { keys: ['first.submit'] },
        resolvedKeys: ['second.submit'],
        targetLocales: ['de'],
      },
      /selection.*resolvedKeys.*filter/i,
    ],
    [
      'unknown key',
      {
        filter: { keys: ['missing.submit'] },
        resolvedKeys: ['missing.submit'],
        targetLocales: ['de'],
      },
      /missing\.submit/i,
    ],
    [
      'locale',
      {
        filter: { keys: ['first.submit'] },
        resolvedKeys: ['first.submit'],
        targetLocales: ['fr'],
      },
      /not configured target locale.*fr/i,
    ],
    [
      'duplicate key',
      {
        filter: { keys: ['first.submit'] },
        resolvedKeys: ['first.submit', 'first.submit'],
        targetLocales: ['de'],
      },
      /duplicate.*resolvedKeys/i,
    ],
  ];

  for (const [label, selection, expected] of cases) {
    const { cwd, config, memory } = fixture();
    writeHandoff(cwd, { ...validHandoff(), selection });
    assert.throws(
      () => requireMarketingKeys(cwd, config, memory),
      expected,
      label,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('schema-v4 active proposals require marketing regeneration', () => {
  const { cwd, config, memory } = fixture();
  fs.writeFileSync(path.join(cwd, '.marketing-loop/proposals.json'), JSON.stringify({
    schemaVersion: 4,
    proposals: [{ before: 'Submit', status: 'pending' }],
  }));

  assert.throws(
    () => requireMarketingKeys(cwd, config, memory),
    /schema v4.*marketing-loop propose/i,
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('deprecated v0.4 raw-text helper remains callable but cannot freeze ambiguous copy', () => {
  const { cwd, config } = fixture();
  fs.writeFileSync(path.join(cwd, '.marketing-loop/proposals.json'), JSON.stringify({
    schemaVersion: 4,
    proposals: [{ before: 'Submit', status: 'pending' }],
  }));

  const installation = detectMarketingLoop(cwd);

  assert.deepEqual(installation.pendingTexts, []);
  assert.deepEqual(frozenTexts(installation, config), new Set());
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('handoff rejects scope, file, hash, status, duplicate, and unknown-key mismatches', () => {
  const cases = [
    ['scope digest', (handoff) => { handoff.scopeDigest = 'stale'; }, /scope digest/i],
    ['catalogue file', (handoff) => { handoff.unresolved[0].file = 'messages/de.json'; }, /catalogue file/i],
    ['source hash', (handoff) => { handoff.unresolved[0].sourceHash = 'stale'; }, /source hash/i],
    ['status', (handoff) => { handoff.unresolved[0].status = 'applied'; }, /status must be pending or approved/i],
    ['duplicate', (handoff) => { handoff.unresolved.push({ ...handoff.unresolved[0] }); }, /duplicate unresolved key/i],
    ['unknown key', (handoff) => { handoff.unresolved[0].key = 'missing.submit'; }, /missing from localization memory/i],
  ];

  for (const [label, mutate, expected] of cases) {
    const { cwd, config, memory } = fixture();
    const handoff = validHandoff();
    mutate(handoff);
    writeHandoff(cwd, handoff);
    assert.throws(
      () => requireMarketingKeys(cwd, config, memory),
      expected,
      label,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('schema-v5 proposals without a handoff require regeneration', () => {
  const { cwd, config, memory } = fixture();
  fs.writeFileSync(path.join(cwd, '.marketing-loop/proposals.json'), JSON.stringify({
    schemaVersion: 5,
    proposals: [],
  }));

  assert.throws(
    () => requireMarketingKeys(cwd, config, memory),
    /schema v5.*without a valid handoff.*marketing-loop propose/i,
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('missing, never-run, and resolved legacy marketing state do not block localization', () => {
  const missing = fixture();
  fs.rmSync(path.join(missing.cwd, '.marketing-loop'), { recursive: true, force: true });
  assert.deepEqual(inspectMarketingHandoff(missing.cwd, missing.config, missing.memory), {
    installed: false,
    hasRun: false,
    compatible: true,
    unresolvedKeys: new Set(),
  });
  fs.rmSync(missing.cwd, { recursive: true, force: true });

  const neverRun = fixture();
  assert.equal(detectMarketingLoop(neverRun.cwd).installed, true);
  assert.equal(detectMarketingLoop(neverRun.cwd).hasRun, false);
  assert.deepEqual(requireMarketingKeys(neverRun.cwd, neverRun.config, neverRun.memory), new Set());
  fs.rmSync(neverRun.cwd, { recursive: true, force: true });

  const resolvedLegacy = fixture();
  fs.writeFileSync(
    path.join(resolvedLegacy.cwd, '.marketing-loop/proposals.json'),
    JSON.stringify({
      schemaVersion: 4,
      proposals: [
        { before: 'Submit', status: 'applied' },
        { before: 'Old submit', status: 'rejected' },
      ],
    }),
  );
  assert.deepEqual(
    requireMarketingKeys(resolvedLegacy.cwd, resolvedLegacy.config, resolvedLegacy.memory),
    new Set(),
  );
  fs.rmSync(resolvedLegacy.cwd, { recursive: true, force: true });
});
