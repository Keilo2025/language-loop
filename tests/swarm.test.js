import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  specialistAgentId,
  swarmBriefSection,
  swarmLeadRule,
  swarmRoster,
  writeSwarmState,
} from '../dist/core/swarm.js';

test('English to German, Russian and French yields three specialists', () => {
  const roster = swarmRoster(['de-DE', 'ru-RU', 'fr-FR']);

  assert.deepEqual(roster.map((item) => item.agentId), [
    'de-DE-specialist',
    'ru-RU-specialist',
    'fr-FR-specialist',
  ]);
  assert.match(roster[0].language, /^German/);
  assert.match(roster[1].language, /^Russian/);
  assert.match(roster[2].language, /^French/);
  assert.equal(specialistAgentId('ja-JP'), 'ja-JP-specialist');
});

test('swarm roster drops duplicate locales', () => {
  const roster = swarmRoster(['de-DE', 'de-DE', 'fr-FR']);
  assert.deepEqual(roster.map((item) => item.locale), ['de-DE', 'fr-FR']);
});

test('lead rule states the three-specialist example', () => {
  const rule = swarmLeadRule();
  assert.match(rule, /Always create a language swarm agent specialist/i);
  assert.match(rule, /German, Russian and French/);
  assert.match(rule, /3 sub-agents/);
  assert.match(rule, /The lead does not translate/);
});

test('brief section marks the active specialist', () => {
  const section = swarmBriefSection(swarmRoster(['de-DE', 'fr-FR']), 'de-DE');
  assert.match(section, /`de-DE-specialist`.*owns this brief/);
  assert.doesNotMatch(section, /`fr-FR-specialist`.*owns this brief/);
});

test('writeSwarmState writes version 1 roster', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-swarm-'));
  const file = writeSwarmState(dir, {
    version: 1,
    sourceLocale: 'en',
    activeLocale: 'de-DE',
    specialists: swarmRoster(['de-DE', 'ru-RU']),
  });
  const written = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert.equal(written.version, 1);
  assert.equal(written.specialists.length, 2);
  assert.equal(written.specialists[0].agentId, 'de-DE-specialist');
  fs.rmSync(dir, { recursive: true, force: true });
});
