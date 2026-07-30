import type {
  Config,
  ComponentContext,
  Memory,
  TranslationArtifact,
  TranslationBatch,
  TranslationUnit,
  Verdict,
  LanguageProgress,
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
import { pendingWork, recordVerdicts } from './memory.js';
import { statePath } from './config.js';
import { writeJson } from './util.js';
import { contextMap } from './context.js';
import { requireMarketingKeys } from './marketing.js';
import {
  languageProgress,
  resolveMessageFilter,
  resolveTargetLocales,
} from './selection.js';

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
  /**
   * Exact canonical catalogue keys this run may process. Omitted preserves the
   * historical all-key behavior; an explicit empty array selects no work.
   */
  keys?: string[];
  /** Called before providers run and after every completed batch. */
  onProgress?: (event: TranslationLoopProgressEvent) => void | Promise<void>;
}

export type RunTranslationLoopStatus =
  | 'complete'
  | 'needs-human'
  | 'no-progress'
  | 'waiting-marketing';

export interface RunTranslationLoopSummary {
  status: RunTranslationLoopStatus;
  batches: number;
  translated: number;
  applied: number;
  rework: number;
  needsHuman: number;
  marketingBlocked: number;
  selectedKeys: string[];
  progress: LanguageProgress[];
}

export interface TranslationLoopProgressEvent {
  schemaVersion: 1;
  status: 'running' | RunTranslationLoopStatus;
  batches: number;
  selectedKeys: string[];
  progress: LanguageProgress[];
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
  const selected = resolveMessageFilter(
    memory.entries,
    input.keys === undefined ? undefined : { keys: input.keys },
  );
  const selectedKeys = new Set(selected.selectedKeys);
  const locales = resolveTargetLocales(config, input.locales);
  const marketingKeys = requireMarketingKeys(cwd, config, memory);
  const selectedMarketingKeys = new Set(
    [...marketingKeys].filter((key) => selectedKeys.has(key)),
  );
  const allPendingWork = () =>
    locales.length
      ? pendingWork(memory, config, locales)
        .filter((item) => selectedKeys.has(item.key))
      : [];
  const eligibleWork = () =>
    allPendingWork().filter((item) => !selectedMarketingKeys.has(item.key));
  const currentProgress = () =>
    languageProgress(memory, locales, selectedKeys, selectedMarketingKeys);
  const syncSummaryState = (summary: RunTranslationLoopSummary): void => {
    summary.progress = currentProgress();
    summary.needsHuman = summary.progress
      .reduce((total, locale) => total + locale.needsHuman, 0);
    summary.marketingBlocked = selectedMarketingKeys.size;
  };
  const terminalStatus = (): RunTranslationLoopStatus | null => {
    if (eligibleWork().length) return null;
    const progress = currentProgress();
    if (progress.some((locale) => locale.pending > 0)) return 'no-progress';
    if (progress.some((locale) => locale.marketingBlocked > 0)) return 'waiting-marketing';
    if (progress.some((locale) => locale.needsHuman > 0)) return 'needs-human';
    return 'complete';
  };
  const summary: RunTranslationLoopSummary = {
    status: 'complete',
    batches: 0,
    translated: 0,
    applied: 0,
    rework: 0,
    needsHuman: 0,
    marketingBlocked: selectedMarketingKeys.size,
    selectedKeys: selected.selectedKeys,
    progress: currentProgress(),
  };
  const emitProgress = async (
    status: TranslationLoopProgressEvent['status'],
  ): Promise<void> => {
    syncSummaryState(summary);
    await input.onProgress?.({
      schemaVersion: 1,
      status,
      batches: summary.batches,
      selectedKeys: [...summary.selectedKeys],
      progress: structuredClone(summary.progress),
    });
  };
  const initial = eligibleWork();
  const hardLimit = Math.max(
    1,
    initial.length * Math.max(1, config.ai.maxAttempts) + Math.ceil(initial.length / Math.max(1, config.maxBatch))
  );
  const initialTerminal = terminalStatus();
  await emitProgress(initialTerminal ?? 'running');
  if (initialTerminal) {
    summary.status = initialTerminal;
    return summary;
  }

  for (let iteration = 0; iteration < hardLimit; iteration++) {
    const pending = eligibleWork();
    if (!pending.length) {
      summary.status = terminalStatus() ?? 'no-progress';
      await emitProgress(summary.status);
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
      keys: selectedKeys,
      locales: new Set(locales),
    });
    summary.applied += applied.approved;

    if (!input.dryRun) {
      clearBatchArtifacts(cwd);
      writeBatch(cwd, batch);
      writeJson(statePath(cwd, 'translations.json'), translations);
      writeJson(statePath(cwd, 'verdicts.json'), verdictArtifact);
    }

    const after = workFingerprint(eligibleWork());
    if (after === before) {
      summary.status = 'no-progress';
      await emitProgress(summary.status);
      return summary;
    }
    const terminal = terminalStatus();
    if (terminal) {
      summary.status = terminal;
      await emitProgress(terminal);
      return summary;
    }
    await emitProgress('running');
  }

  syncSummaryState(summary);
  summary.status = terminalStatus() ?? 'no-progress';
  await emitProgress(summary.status);
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
