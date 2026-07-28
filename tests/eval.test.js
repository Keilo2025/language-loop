import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateCorpus,
  loadEvalCandidates,
  loadEvalCorpus,
} from '../dist/core/eval.js';

const corpusPath = path.join(process.cwd(), 'evals', 'multilingual.jsonl');
const candidatesPath = path.join(process.cwd(), 'tests', 'fixtures', 'eval-candidates.jsonl');

test('multilingual evaluation corpus covers the required locales and risk classes', () => {
  const corpus = loadEvalCorpus(corpusPath);
  assert.equal(corpus.length, 25);
  assert.deepEqual(
    [...new Set(corpus.map((record) => record.locale))].sort(),
    ['ar-SA', 'de-DE', 'fr-FR', 'ja-JP', 'pt-BR']
  );
  const tags = new Set(corpus.flatMap((record) => record.tags));
  for (const required of ['critical', 'destructive', 'formal', 'icu', 'length-pressure', 'rtl']) {
    assert.ok(tags.has(required), `missing ${required} coverage`);
  }
  assert.ok(corpus.every((record) => record.context && record.reference));
});

test('multilingual evaluation passes the reviewed reference candidates per locale', () => {
  const report = evaluateCorpus(
    loadEvalCorpus(corpusPath),
    loadEvalCandidates(candidatesPath)
  );
  assert.equal(report.ok, true);
  assert.equal(report.total, 25);
  assert.equal(report.passed, 25);
  assert.equal(report.referenceMatches, 25);
  assert.deepEqual(
    Object.fromEntries(Object.entries(report.byLocale).map(([locale, value]) => [locale, value.passed])),
    { 'de-DE': 5, 'fr-FR': 5, 'ja-JP': 5, 'pt-BR': 5, 'ar-SA': 5 }
  );
});

test('multilingual evaluation catches placeholder, terminology, and critical meaning mutations', () => {
  const corpus = loadEvalCorpus(corpusPath);
  const candidates = loadEvalCandidates(candidatesPath).map((candidate) => ({ ...candidate }));
  candidates.find((candidate) => candidate.id === 'fr-FR.welcome.named').translation = 'Bon retour';
  candidates.find((candidate) => candidate.id === 'de-DE.account.delete').translation = 'Konto behalten';
  candidates.find((candidate) => candidate.id === 'ja-JP.session.formal').translation =
    'セッションの有効期限が切れました。';

  const report = evaluateCorpus(corpus, candidates);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((finding) =>
    finding.id === 'fr-FR.welcome.named' && finding.rule === 'placeholder'
  ));
  assert.ok(report.findings.some((finding) =>
    finding.id === 'de-DE.account.delete' && finding.rule === 'critical-mutation'
  ));
  assert.ok(report.findings.some((finding) =>
    finding.id === 'ja-JP.session.formal' && finding.rule === 'protected-term'
  ));
});

test('multilingual evaluation fails closed on incomplete candidate coverage', () => {
  const corpus = loadEvalCorpus(corpusPath);
  const candidates = loadEvalCandidates(candidatesPath).slice(1);
  const report = evaluateCorpus(corpus, candidates);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((finding) =>
    finding.id === 'de-DE.cta.start-free' && finding.rule === 'missing-candidate'
  ));

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'll-eval-')), 'bad.jsonl');
  fs.writeFileSync(file, '{"id":"x","translation":"a"}\n{"id":"x","translation":"b"}\n');
  assert.throws(() => loadEvalCandidates(file), /duplicate.*x/i);
});
