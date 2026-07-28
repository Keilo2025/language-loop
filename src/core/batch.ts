import fs from 'node:fs';
import crypto from 'node:crypto';
import type {
  BoundVerdict,
  TranslationArtifact,
  TranslationBatch,
  TranslationCandidate,
  Verdict,
  VerdictArtifact,
  WorkItem,
  Memory,
} from '../types.js';
import { statePath } from './config.js';
import { exists, readJsonPrecious, sha, writeJson } from './util.js';

export const BATCH_FILE = 'batch.json';
export const TRANSLATIONS_FILE = 'translations.json';
export const VERDICTS_FILE = 'verdicts.json';

export function unitId(key: string, locale: string): string {
  return `${key}::${locale}`;
}

export function candidateHash(
  batchId: string,
  key: string,
  locale: string,
  sourceHash: string,
  value: string
): string {
  return sha(JSON.stringify([batchId, key, locale, sourceHash, value]));
}

export function createBatch(
  work: WorkItem[],
  options: {
    id?: string;
    createdAt?: string;
    sourceLocale?: string;
    contextHashes?: ReadonlyMap<string, string>;
  } = {}
): TranslationBatch {
  const seen = new Set<string>();
  const units = work.map((item) => {
    const id = unitId(item.key, item.locale);
    if (seen.has(id)) throw new Error(`Cannot create translation batch: duplicate unit ${id}.`);
    seen.add(id);
    return {
      key: item.key,
      locale: item.locale,
      source: item.source,
      sourceHash: sha(item.source),
      contextHash: options.contextHashes?.get(id) ?? sha(''),
      kind: item.kind,
      file: item.file,
      line: item.line,
      component: item.component,
      placeholders: [...item.placeholders],
      attempt: item.attempt ?? 1,
    };
  });
  if (!units.length) throw new Error('Cannot create an empty translation batch.');
  return {
    version: 1,
    id: options.id ?? crypto.randomUUID(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    sourceLocale: options.sourceLocale ?? 'en',
    units,
  };
}

export function writeBatch(cwd: string, batch: TranslationBatch): void {
  writeJson(statePath(cwd, BATCH_FILE), batch);
}

export function readBatch(cwd: string): TranslationBatch {
  const file = statePath(cwd, BATCH_FILE);
  if (!exists(file)) {
    throw new Error('No active translation batch. Run language-loop translate first.');
  }
  const batch = readJsonPrecious<TranslationBatch | null>(file, null);
  if (!batch || batch.version !== 1 || typeof batch.id !== 'string' || !Array.isArray(batch.units)) {
    throw new Error(`${file} is not a valid version 1 translation batch.`);
  }
  const seen = new Set<string>();
  for (const unit of batch.units) {
    const id = unitId(unit.key, unit.locale);
    if (seen.has(id)) throw new Error(`${file} contains duplicate batch unit ${id}.`);
    seen.add(id);
    if (unit.sourceHash !== sha(unit.source)) {
      throw new Error(`${file} has an invalid source hash for ${id}.`);
    }
  }
  return batch;
}

export function validateBatchAgainstMemory(batch: TranslationBatch, memory: Memory): void {
  for (const unit of batch.units) {
    const id = unitId(unit.key, unit.locale);
    const entry = memory.entries[unit.key];
    if (!entry) throw new Error(`Active batch contains ${id}, but that key is no longer in translation memory.`);
    if (entry.sourceHash !== unit.sourceHash || entry.source !== unit.source) {
      throw new Error(
        `Active batch source changed for ${id}. Run language-loop translate again to create a fresh batch.`
      );
    }
  }
}

export function clearBatchArtifacts(cwd: string): string[] {
  const removed: string[] = [];
  for (const file of [TRANSLATIONS_FILE, VERDICTS_FILE, 'judge.md']) {
    const full = statePath(cwd, file);
    if (!exists(full)) continue;
    fs.rmSync(full, { force: true });
    removed.push(file);
  }
  return removed;
}

export function bindTranslationArtifact(
  batch: TranslationBatch,
  translations: { key: string; locale: string; value: string; note?: string }[],
  producer: string
): TranslationArtifact {
  const units = unitMap(batch);
  const bound = translations.map((item): TranslationCandidate => {
    const id = unitId(item.key, item.locale);
    const unit = units.get(id);
    if (!unit) throw new Error(`Translation artifact has extra unit ${id}.`);
    return {
      key: item.key,
      locale: item.locale,
      value: item.value,
      ...(item.note ? { note: item.note } : {}),
      sourceHash: unit.sourceHash,
      candidateHash: candidateHash(batch.id, item.key, item.locale, unit.sourceHash, item.value),
    };
  });
  const artifact: TranslationArtifact = {
    version: 1,
    batchId: batch.id,
    producer,
    translations: bound,
  };
  return validateTranslationArtifact(batch, artifact);
}

/**
 * Canonicalize an agent-authored submission. The agent is not asked to compute
 * hashes, but it must echo the active batch and per-unit source hashes. Once
 * accepted, this function adds candidate hashes and callers persist only the
 * canonical artifact.
 */
export function bindTranslationSubmission(batch: TranslationBatch, input: unknown): TranslationArtifact {
  const submission = input as {
    version?: unknown;
    batchId?: unknown;
    producer?: unknown;
    translations?: {
      key?: unknown;
      locale?: unknown;
      value?: unknown;
      note?: unknown;
      sourceHash?: unknown;
    }[];
  } | null;
  if (!submission || submission.version !== 1 || !Array.isArray(submission.translations)) {
    throw new Error('translations.json is not a version 1 translation submission.');
  }
  if (submission.batchId !== batch.id) {
    throw new Error(`Translation submission batch id does not match the active batch (${batch.id}).`);
  }
  if (typeof submission.producer !== 'string' || !submission.producer.trim()) {
    throw new Error('Translation submission must name its producer.');
  }
  const expected = unitMap(batch);
  const seen = new Set<string>();
  const raw: { key: string; locale: string; value: string; note?: string }[] = [];
  for (const item of submission.translations) {
    if (typeof item.key !== 'string' || typeof item.locale !== 'string') {
      throw new Error('Translation submission contains a record without a string key and locale.');
    }
    const id = unitId(item.key, item.locale);
    if (seen.has(id)) throw new Error(`Translation submission has duplicate unit ${id}.`);
    seen.add(id);
    const unit = expected.get(id);
    if (!unit) throw new Error(`Translation submission has extra unit ${id}.`);
    if (item.sourceHash !== unit.sourceHash) {
      throw new Error(`Translation submission source hash does not match ${id}.`);
    }
    if (typeof item.value !== 'string') throw new Error(`Translation submission value for ${id} must be a string.`);
    raw.push({
      key: item.key,
      locale: item.locale,
      value: item.value,
      ...(typeof item.note === 'string' && item.note ? { note: item.note } : {}),
    });
  }
  const missing = [...expected.keys()].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`Translation submission is missing ${missing.join(', ')}.`);
  return bindTranslationArtifact(batch, raw, submission.producer);
}

export function validateTranslationArtifact(
  batch: TranslationBatch,
  input: unknown
): TranslationArtifact {
  const artifact = input as Partial<TranslationArtifact> | null;
  if (!artifact || artifact.version !== 1 || !Array.isArray(artifact.translations)) {
    throw new Error('translations.json is not a version 1 translation artifact.');
  }
  if (artifact.batchId !== batch.id) {
    throw new Error(`Translation artifact batch id does not match the active batch (${batch.id}).`);
  }
  if (typeof artifact.producer !== 'string' || !artifact.producer.trim()) {
    throw new Error('Translation artifact must name its producer.');
  }

  const expected = unitMap(batch);
  const seen = new Set<string>();
  for (const candidate of artifact.translations) {
    if (!candidate || typeof candidate.key !== 'string' || typeof candidate.locale !== 'string') {
      throw new Error('Translation artifact contains a record without a string key and locale.');
    }
    const id = unitId(candidate.key, candidate.locale);
    if (seen.has(id)) throw new Error(`Translation artifact has duplicate unit ${id}.`);
    seen.add(id);
    const unit = expected.get(id);
    if (!unit) throw new Error(`Translation artifact has extra unit ${id}.`);
    if (typeof candidate.value !== 'string') {
      throw new Error(`Translation artifact value for ${id} must be a string.`);
    }
    if (candidate.sourceHash !== unit.sourceHash) {
      throw new Error(`Translation artifact source hash does not match ${id}.`);
    }
    const wanted = candidateHash(batch.id, candidate.key, candidate.locale, unit.sourceHash, candidate.value);
    if (candidate.candidateHash !== wanted) {
      throw new Error(`Translation artifact candidate hash does not match ${id}.`);
    }
  }
  const missing = [...expected.keys()].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`Translation artifact is missing ${missing.join(', ')}.`);
  return artifact as TranslationArtifact;
}

export function bindVerdictArtifact(
  batch: TranslationBatch,
  translations: TranslationArtifact,
  verdicts: Verdict[],
  producer: string
): VerdictArtifact {
  const checked = validateTranslationArtifact(batch, translations);
  const candidates = candidateMap(checked);
  const bound = verdicts.map((verdict): BoundVerdict => {
    const id = unitId(verdict.key, verdict.locale);
    const candidate = candidates.get(id);
    if (!candidate) throw new Error(`Verdict artifact has extra unit ${id}.`);
    return {
      ...verdict,
      sourceHash: candidate.sourceHash,
      candidateHash: candidate.candidateHash,
    };
  });
  return validateVerdictArtifact(batch, checked, {
    version: 1,
    batchId: batch.id,
    producer,
    verdicts: bound,
  });
}

export function validateVerdictArtifact(
  batch: TranslationBatch,
  translations: TranslationArtifact,
  input: unknown
): VerdictArtifact {
  const checked = validateTranslationArtifact(batch, translations);
  const artifact = input as Partial<VerdictArtifact> | null;
  if (!artifact || artifact.version !== 1 || !Array.isArray(artifact.verdicts)) {
    throw new Error('verdicts.json is not a version 1 verdict artifact.');
  }
  if (artifact.batchId !== batch.id) {
    throw new Error(`Verdict artifact batch id does not match the active batch (${batch.id}).`);
  }
  if (typeof artifact.producer !== 'string' || !artifact.producer.trim()) {
    throw new Error('Verdict artifact must name its producer.');
  }

  const candidates = candidateMap(checked);
  const seen = new Set<string>();
  for (const verdict of artifact.verdicts) {
    if (!verdict || typeof verdict.key !== 'string' || typeof verdict.locale !== 'string') {
      throw new Error('Verdict artifact contains a record without a string key and locale.');
    }
    const id = unitId(verdict.key, verdict.locale);
    if (seen.has(id)) throw new Error(`Verdict artifact has duplicate unit ${id}.`);
    seen.add(id);
    const candidate = candidates.get(id);
    if (!candidate) throw new Error(`Verdict artifact has extra unit ${id}.`);
    if (verdict.sourceHash !== candidate.sourceHash) {
      throw new Error(`Verdict artifact source hash does not match ${id}.`);
    }
    if (verdict.candidateHash !== candidate.candidateHash) {
      throw new Error(`Verdict artifact candidate hash does not match ${id}.`);
    }
    if (typeof verdict.ok !== 'boolean') throw new Error(`Verdict for ${id} must include boolean ok.`);
    if (!verdict.ok && !(typeof verdict.reason === 'string' && verdict.reason.trim())) {
      throw new Error(`Rejected verdict for ${id} must include a reason.`);
    }
  }
  const missing = [...candidates.keys()].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`Verdict artifact is missing ${missing.join(', ')}.`);
  return artifact as VerdictArtifact;
}

function unitMap(batch: TranslationBatch): Map<string, TranslationBatch['units'][number]> {
  return new Map(batch.units.map((unit) => [unitId(unit.key, unit.locale), unit]));
}

function candidateMap(artifact: TranslationArtifact): Map<string, TranslationCandidate> {
  return new Map(artifact.translations.map((item) => [unitId(item.key, item.locale), item]));
}
