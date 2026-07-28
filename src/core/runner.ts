import type {
  Config,
  ComponentContext,
  Memory,
  TranslationArtifact,
  TranslationBatch,
  TranslationUnit,
  Verdict,
} from '../types.js';
import {
  bindTranslationArtifact,
  bindVerdictArtifact,
  clearBatchArtifacts,
  createBatch,
  unitId,
  writeBatch,
} from './batch.js';
import { applyDecisions, type Decision } from './apply.js';
import { checkTranslations, partition } from './guardrails.js';
import { needsHuman, pendingWork, recordVerdicts } from './memory.js';
import { statePath } from './config.js';
import { writeJson } from './util.js';
import { contextMap } from './context.js';

export type RunnerTranslator = (
  batch: TranslationBatch,
  contexts: ReadonlyMap<string, ComponentContext>
) => Promise<{ key: string; locale: string; value: string; note?: string }[]>;

export type RunnerJudge = (
  batch: TranslationBatch,
  translations: TranslationArtifact,
  units: TranslationUnit[],
  contexts: ReadonlyMap<string, ComponentContext>
) => Promise<Verdict[]>;

export interface RunTranslationLoopInput {
  cwd: string;
  memory: Memory;
  config: Config;
  translator: RunnerTranslator;
  judge: RunnerJudge;
  dryRun?: boolean;
  locales?: string[];
}

export interface RunTranslationLoopSummary {
  status: 'complete' | 'needs-human' | 'no-progress';
  batches: number;
  translated: number;
  applied: number;
  rework: number;
  needsHuman: number;
}

/**
 * The programmatic end-to-end loop. Both the CLI and integrations use this
 * path, which keeps staged/manual and provider-backed state transitions equal.
 */
export async function runTranslationLoop(
  input: RunTranslationLoopInput
): Promise<RunTranslationLoopSummary> {
  const { cwd, config, translator, judge } = input;
  const memory = input.dryRun ? structuredClone(input.memory) : input.memory;
  const summary: RunTranslationLoopSummary = {
    status: 'complete',
    batches: 0,
    translated: 0,
    applied: 0,
    rework: 0,
    needsHuman: 0,
  };
  const initial = pendingWork(memory, config, input.locales);
  const hardLimit = Math.max(
    1,
    initial.length * Math.max(1, config.ai.maxAttempts) + Math.ceil(initial.length / Math.max(1, config.maxBatch))
  );

  for (let iteration = 0; iteration < hardLimit; iteration++) {
    const pending = pendingWork(memory, config, input.locales);
    if (!pending.length) {
      const terminal = needsHuman(memory).length;
      summary.needsHuman = terminal;
      summary.status = terminal ? 'needs-human' : 'complete';
      return summary;
    }
    const before = workFingerprint(pending);
    const locale = pending[0]!.locale;
    const work = pending.filter((item) => item.locale === locale).slice(0, config.maxBatch);
    const contexts = contextMap(cwd, memory, work);
    const batch = createBatch(work, {
      sourceLocale: config.sourceLocale,
      contextHashes: new Map([...contexts].map(([id, context]) => [id, context.hash])),
    });

    const rawCandidates = await translator(batch, contexts);
    const translations = bindTranslationArtifact(batch, rawCandidates, 'runner:translator');
    summary.batches++;
    summary.translated += translations.translations.length;

    const units = translationUnits(batch, translations, memory);
    const { kept, blocked } = partition(units, checkTranslations(units, config));
    const candidateById = new Map(
      translations.translations.map((item) => [unitId(item.key, item.locale), item])
    );
    const guardrailVerdicts: Verdict[] = blocked.map(({ unit, issues }) => ({
      key: unit.key,
      locale: unit.locale,
      ok: false,
      reason: issues.map((issue) => `${issue.rule}: ${issue.message}`).join('; '),
      by: 'guardrail',
    } as Verdict));
    const judgeVerdicts = kept.length
      ? (await judge(batch, translations, kept, contexts)).map((verdict) => ({ ...verdict, by: 'judge' }))
      : [];
    const verdictArtifact = bindVerdictArtifact(
      batch,
      translations,
      [...guardrailVerdicts, ...judgeVerdicts],
      'runner:judge'
    );
    const values = new Map(
      translations.translations.map((item) => [unitId(item.key, item.locale), item.value])
    );
    const transition = recordVerdicts(memory, verdictArtifact.verdicts, values, config);
    summary.rework += transition.rework;
    summary.needsHuman += transition.needsHuman;

    const decisions: Record<string, Decision> = {};
    for (const verdict of verdictArtifact.verdicts) {
      if (!verdict.ok) continue;
      const candidate = candidateById.get(unitId(verdict.key, verdict.locale))!;
      decisions[unitId(verdict.key, verdict.locale)] = {
        key: verdict.key,
        locale: verdict.locale,
        approved: true,
        value: candidate.value,
        editedByHuman: false,
      };
    }
    const applied = applyDecisions(cwd, memory, config, decisions, {
      dryRun: input.dryRun,
    });
    summary.applied += applied.approved;

    if (!input.dryRun) {
      clearBatchArtifacts(cwd);
      writeBatch(cwd, batch);
      writeJson(statePath(cwd, 'translations.json'), translations);
      writeJson(statePath(cwd, 'verdicts.json'), verdictArtifact);
    }

    const after = workFingerprint(pendingWork(memory, config, input.locales));
    if (after === before) {
      summary.status = 'no-progress';
      return summary;
    }
  }

  summary.needsHuman = needsHuman(memory).length;
  summary.status = summary.needsHuman ? 'needs-human' : 'no-progress';
  return summary;
}

function translationUnits(
  batch: TranslationBatch,
  translations: TranslationArtifact,
  memory: Memory
): TranslationUnit[] {
  const byId = new Map(batch.units.map((unit) => [unitId(unit.key, unit.locale), unit]));
  return translations.translations.map((candidate) => {
    const unit = byId.get(unitId(candidate.key, candidate.locale))!;
    return {
      key: candidate.key,
      locale: candidate.locale,
      source: unit.source,
      value: candidate.value,
      kind: unit.kind,
      file: unit.file,
      placeholders: unit.placeholders,
      status: memory.entries[candidate.key]?.translations[candidate.locale]?.status === 'stale'
        ? 'stale'
        : 'pending',
      notes: candidate.note,
    };
  });
}

function workFingerprint(work: ReturnType<typeof pendingWork>): string {
  return JSON.stringify(work.map((item) => [
    item.key,
    item.locale,
    item.reason,
    item.attempt ?? 1,
    item.previous ?? '',
    item.judgeNote ?? '',
  ]));
}
