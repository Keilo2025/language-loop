import path from 'node:path';
import type {
  Config,
  ContentLoopSelection,
  KeyedString,
  LanguageProgress,
  MarketingHandoffState,
  Memory,
  MemoryEntry,
  MessageFilter,
  ResolvedMessageFilter,
} from './types.js';
import { loadConfig, requireConfig, statePath } from './core/config.js';
import { scanKeyUsage, scanRepo } from './core/scan.js';
import { assignKeys } from './core/keys.js';
import {
  applyExtraction,
  planExtraction,
  type ExtractPlan,
  type ExtractResult,
} from './core/extract.js';
import {
  adoptCatalogEdits,
  adoptSourceEdits,
  deadKeys,
  loadMemory,
  localeCatalog,
  pendingWork,
  pruneMemory,
  saveMemory,
  setFallback,
  sourceCatalog,
  syncMemory,
} from './core/memory.js';
import { Backup } from './core/backup.js';
import { readCatalog, writeCatalog, type Flat } from './core/catalog.js';
import { inspectMarketingHandoff } from './core/marketing.js';
import {
  languageProgress,
  resolveMessageFilter,
  resolveTargetLocales,
} from './core/selection.js';
import {
  runTranslationLoop,
  type RunTranslationLoopStatus,
  type RunnerJudge,
  type RunnerTranslator,
  type TranslationLoopProgressEvent,
} from './core/runner.js';
import { writeJson } from './core/util.js';

/** Capability marker checked by Marketing Loop before selection-aware execution. */
export const CONTENT_LOOP_API_VERSION = 1 as const;

export type LanguageLoopPhase =
  | 'needs-init'
  | 'needs-extraction'
  | 'ready-translation'
  | 'waiting-marketing'
  | 'needs-human'
  | 'complete'
  | 'blocked';

export type LanguageLoopNextStage =
  | 'init'
  | 'extract'
  | 'translate'
  | 'marketing'
  | 'human-review'
  | 'none';

export type ContentLoopErrorCode =
  | 'INVALID_FILTER'
  | 'FILTER_MISMATCH'
  | 'INVALID_LOCALE'
  | 'SELECTION_MISMATCH'
  | 'INVALID_STATE'
  | 'MARKETING_INCOMPATIBLE';

export class ContentLoopOrchestrationError extends Error {
  constructor(
    public readonly code: ContentLoopErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ContentLoopOrchestrationError';
  }
}

export interface LanguageLoopScopeInput {
  cwd: string;
  filter?: MessageFilter;
  /** Exact canonical keys. When filter is also supplied, both must resolve identically. */
  keys?: string[];
  /** Configured target locales. Omitted means every configured target locale. */
  locales?: string[];
}

export interface LanguageLoopSnapshot {
  schemaVersion: 1;
  apiVersion: typeof CONTENT_LOOP_API_VERSION;
  phase: LanguageLoopPhase;
  nextStage: LanguageLoopNextStage;
  filter: ResolvedMessageFilter;
  targetLocales: string[];
  hardcoded: number;
  openItems: number;
  marketing: {
    installed: boolean;
    compatible: boolean;
    unresolvedKeys: string[];
    selectedUnresolvedKeys: string[];
    selection?: ContentLoopSelection;
  };
  progress: LanguageProgress[];
  error?: {
    code: ContentLoopErrorCode;
    message: string;
  };
}

export interface InspectLanguageLoopInput extends LanguageLoopScopeInput {}

export interface ExtractLanguageLoopInput
  extends Omit<LanguageLoopScopeInput, 'locales'> {
  dryRun?: boolean;
  prune?: boolean;
}

export interface ExtractLanguageLoopResult {
  schemaVersion: 1;
  apiVersion: typeof CONTENT_LOOP_API_VERSION;
  status: 'complete' | 'open-items' | 'no-work';
  filter: ResolvedMessageFilter;
  applied: ExtractResult['applied'];
  skipped: ExtractResult['skipped'];
  filesTouched: string[];
  wiringAdded: number;
  backupId: string | null;
  openItems: ExtractPlan['openItems'];
  memory: {
    added: string[];
    changed: string[];
    unchanged: string[];
    dead: string[];
    pruned: string[];
  };
}

export interface RunLanguageLoopInput extends LanguageLoopScopeInput {
  translator: RunnerTranslator;
  judge: RunnerJudge;
  dryRun?: boolean;
  onProgress?: (event: TranslationLoopProgressEvent) => void | Promise<void>;
}

export interface RunLanguageLoopResult {
  schemaVersion: 1;
  apiVersion: typeof CONTENT_LOOP_API_VERSION;
  status: RunTranslationLoopStatus;
  filter: ResolvedMessageFilter;
  targetLocales: string[];
  batches: number;
  translated: number;
  applied: number;
  rework: number;
  needsHuman: number;
  marketingBlocked: number;
  progress: LanguageProgress[];
}

export function inspectLanguageLoop(
  input: InspectLanguageLoopInput,
): LanguageLoopSnapshot {
  const config = loadConfig(input.cwd);
  if (!config || !config.locales.length) {
    return emptySnapshot('needs-init', 'init');
  }

  try {
    const memory = structuredClone(loadMemory(input.cwd, config.sourceLocale));
    const scan = scanRepo(input.cwd, config);
    const keyed = assignKeys(scan.strings, config, memory, reservedKeys(input.cwd, config));
    const entries = selectableEntries(memory, keyed);
    const marketingBefore = inspectMarketingHandoff(input.cwd, config, memory);
    const scope = resolveScope(entries, config, marketingBefore, input);
    const selectedKeys = new Set(scope.filter.selectedKeys);
    adoptSourceEdits(input.cwd, memory, config, selectedKeys);
    adoptCatalogEdits(input.cwd, memory, config, selectedKeys);
    const marketing = inspectMarketingHandoff(input.cwd, config, memory);
    const hardcodedKeys = keyed.filter((item) => selectedKeys.has(item.key));
    const openItems = planExtraction(input.cwd, hardcodedKeys, config).openItems.length;
    const selectedMemoryKeys = new Set(
      scope.filter.selectedKeys.filter((key) => key in memory.entries),
    );
    const selectedUnresolvedKeys = [...marketing.unresolvedKeys]
      .filter((key) => selectedMemoryKeys.has(key))
      .sort();
    const unresolved = new Set(selectedUnresolvedKeys);
    const progress = languageProgress(
      memory,
      scope.targetLocales,
      selectedMemoryKeys,
      unresolved,
    );
    const eligible = pendingWork(memory, config, scope.targetLocales)
      .filter((item) => selectedMemoryKeys.has(item.key) && !unresolved.has(item.key));

    let phase: LanguageLoopPhase;
    let nextStage: LanguageLoopNextStage;
    let error: LanguageLoopSnapshot['error'];
    if (hardcodedKeys.length) {
      phase = 'needs-extraction';
      nextStage = 'extract';
    } else if (!marketing.compatible) {
      phase = 'blocked';
      nextStage = 'marketing';
      error = {
        code: 'MARKETING_INCOMPATIBLE',
        message: marketing.error ?? 'Marketing handoff is incompatible',
      };
    } else if (eligible.length) {
      phase = 'ready-translation';
      nextStage = 'translate';
    } else if (selectedUnresolvedKeys.length) {
      phase = 'waiting-marketing';
      nextStage = 'marketing';
    } else if (progress.some((locale) => locale.needsHuman > 0)) {
      phase = 'needs-human';
      nextStage = 'human-review';
    } else if (progress.some((locale) => locale.pending > 0)) {
      phase = 'blocked';
      nextStage = 'none';
      error = {
        code: 'INVALID_STATE',
        message: 'Selected translation state is incomplete but has no runnable work',
      };
    } else {
      phase = 'complete';
      nextStage = 'none';
    }

    return {
      schemaVersion: 1,
      apiVersion: CONTENT_LOOP_API_VERSION,
      phase,
      nextStage,
      filter: scope.filter,
      targetLocales: scope.targetLocales,
      hardcoded: hardcodedKeys.length,
      openItems,
      marketing: marketingSnapshot(marketing, selectedUnresolvedKeys),
      progress,
      ...(error ? { error } : {}),
    };
  } catch (error) {
    return blockedSnapshot(error);
  }
}

export function extractLanguageLoop(
  input: ExtractLanguageLoopInput,
): ExtractLanguageLoopResult {
  const config = requireConfig(input.cwd);
  const memory = loadMemory(input.cwd, config.sourceLocale);
  const scan = scanRepo(input.cwd, config);
  const keyed = assignKeys(scan.strings, config, memory, reservedKeys(input.cwd, config));
  const entries = selectableEntries(memory, keyed);
  const filter = resolveCallerFilter(entries, input.filter, input.keys);
  const selectedKeys = new Set(filter.selectedKeys);
  adoptCatalogEdits(input.cwd, memory, config, selectedKeys);
  adoptSourceEdits(input.cwd, memory, config, selectedKeys);
  const selected = keyed.filter((item) => selectedKeys.has(item.key));
  const plan = planExtraction(input.cwd, selected, config);
  const transaction = input.dryRun ? undefined : new Backup(input.cwd, 'extract');

  let result: ExtractResult;
  try {
    result = applyExtraction(
      input.cwd,
      plan,
      config,
      input.dryRun ?? false,
      transaction,
    );
  } catch (error) {
    transaction?.rollback();
    throw error;
  }

  const emptyMemory = {
    added: [] as string[],
    changed: [] as string[],
    unchanged: [] as string[],
    dead: [] as string[],
    pruned: [] as string[],
  };
  if (input.dryRun) {
    return extractionResult(filter, result, plan, emptyMemory);
  }

  try {
    const applied = new Set(result.applied.map((edit) => edit.key));
    const landed = selected.filter((item) => applied.has(item.key));
    const sync = syncMemory(memory, landed, config);
    const allDead = deadKeys(
      memory,
      config,
      scanKeyUsage(input.cwd, config),
      new Set(keyed.map((item) => item.key)),
    );
    const dead = allDead.filter((key) => selectedKeys.has(key));
    const pruned = input.prune ? pruneMemory(memory, dead) : [];

    transaction!.capture(path.relative(input.cwd, statePath(input.cwd, 'memory.json')));
    transaction!.capture(path.relative(input.cwd, statePath(input.cwd, 'open-items.json')));
    writeJson(statePath(input.cwd, 'open-items.json'), plan.openItems);
    writeSelectedCatalogues(
      input.cwd,
      memory,
      config,
      selectedKeys,
      new Set(pruned),
      input.filter !== undefined || input.keys !== undefined,
      input.prune ?? false,
      transaction!,
    );
    saveMemory(input.cwd, memory);
    result.backupId = transaction!.commit();
    return extractionResult(filter, result, plan, {
      added: sync.added,
      changed: sync.changed,
      unchanged: sync.unchanged,
      dead,
      pruned,
    });
  } catch (error) {
    transaction!.rollback();
    throw error;
  }
}

export async function runLanguageLoop(
  input: RunLanguageLoopInput,
): Promise<RunLanguageLoopResult> {
  const config = requireConfig(input.cwd);
  const memory = loadMemory(input.cwd, config.sourceLocale);
  const marketingBefore = inspectMarketingHandoff(input.cwd, config, memory);
  if (!marketingBefore.compatible) {
    throw new ContentLoopOrchestrationError(
      'MARKETING_INCOMPATIBLE',
      marketingBefore.error ?? 'Marketing handoff is incompatible',
    );
  }
  const scope = resolveScope(memory.entries, config, marketingBefore, input);
  const selectedKeys = new Set(scope.filter.selectedKeys);
  adoptCatalogEdits(input.cwd, memory, config, selectedKeys);
  adoptSourceEdits(input.cwd, memory, config, selectedKeys);
  const marketing = inspectMarketingHandoff(input.cwd, config, memory);
  if (!marketing.compatible) {
    throw new ContentLoopOrchestrationError(
      'MARKETING_INCOMPATIBLE',
      marketing.error ?? 'Marketing handoff is incompatible',
    );
  }

  const summary = await runTranslationLoop({
    cwd: input.cwd,
    memory,
    config,
    translator: input.translator,
    judge: input.judge,
    dryRun: input.dryRun,
    locales: scope.targetLocales,
    keys: scope.filter.selectedKeys,
    onProgress: input.onProgress,
  });
  if (!input.dryRun && summary.batches === 0) saveMemory(input.cwd, memory);
  return {
    schemaVersion: 1,
    apiVersion: CONTENT_LOOP_API_VERSION,
    status: summary.status,
    filter: scope.filter,
    targetLocales: scope.targetLocales,
    batches: summary.batches,
    translated: summary.translated,
    applied: summary.applied,
    rework: summary.rework,
    needsHuman: summary.needsHuman,
    marketingBlocked: summary.marketingBlocked,
    progress: summary.progress,
  };
}

function resolveScope(
  entries: Readonly<Record<string, Pick<MemoryEntry, 'kind' | 'namespace'>>>,
  config: Config,
  marketing: MarketingHandoffState,
  input: Pick<LanguageLoopScopeInput, 'filter' | 'keys' | 'locales'>,
): { filter: ResolvedMessageFilter; targetLocales: string[] } {
  const callerFilter = resolveCallerFilter(entries, input.filter, input.keys);
  const callerLocales = resolveTargetLocales(config, input.locales);
  if (!marketing.selection) {
    return { filter: callerFilter, targetLocales: callerLocales };
  }

  const authoritative = resolveMessageFilter(entries, marketing.selection.filter);
  if (!sameStrings(authoritative.selectedKeys, marketing.selection.resolvedKeys)) {
    throw new ContentLoopOrchestrationError(
      'SELECTION_MISMATCH',
      'Marketing handoff resolvedKeys no longer match its filter',
    );
  }
  if (
    (input.filter !== undefined || input.keys !== undefined) &&
    !sameStrings(callerFilter.selectedKeys, authoritative.selectedKeys)
  ) {
    throw new ContentLoopOrchestrationError(
      'SELECTION_MISMATCH',
      'Caller key/filter scope does not match the Marketing handoff selection',
    );
  }
  if (
    input.locales !== undefined &&
    !sameStrings(callerLocales, marketing.selection.targetLocales)
  ) {
    throw new ContentLoopOrchestrationError(
      'SELECTION_MISMATCH',
      'Caller target locales do not match the Marketing handoff selection',
    );
  }
  return {
    filter: {
      ...authoritative,
      requested: {
        categories: marketing.selection.filter.categories ?? [],
        groups: marketing.selection.filter.groups ?? [],
        keys: marketing.selection.filter.keys ?? [],
      },
    },
    targetLocales: [...marketing.selection.targetLocales],
  };
}

function resolveCallerFilter(
  entries: Readonly<Record<string, Pick<MemoryEntry, 'kind' | 'namespace'>>>,
  filter?: MessageFilter,
  keys?: string[],
): ResolvedMessageFilter {
  const byFilter = filter === undefined ? undefined : resolveMessageFilter(entries, filter);
  const byKeys = keys === undefined
    ? undefined
    : resolveMessageFilter(entries, { keys });
  if (byFilter && byKeys && !sameStrings(byFilter.selectedKeys, byKeys.selectedKeys)) {
    throw new ContentLoopOrchestrationError(
      'SELECTION_MISMATCH',
      'Caller filter and exact keys resolve to different execution scopes',
    );
  }
  return byFilter ?? byKeys ?? resolveMessageFilter(entries);
}

function selectableEntries(
  memory: Memory,
  keyed: readonly KeyedString[],
): Record<string, Pick<MemoryEntry, 'kind' | 'namespace'>> {
  const entries: Record<string, Pick<MemoryEntry, 'kind' | 'namespace'>> =
    Object.fromEntries(
      Object.entries(memory.entries)
        .map(([key, entry]) => [key, { kind: entry.kind, namespace: entry.namespace }]),
    );
  for (const item of keyed) {
    entries[item.key] = { kind: item.kind, namespace: item.namespace };
  }
  return entries;
}

function reservedKeys(cwd: string, config: Config): Set<string> {
  const keys = new Set<string>();
  for (const locale of config.locales) {
    for (const key of Object.keys(readCatalog(cwd, config, locale))) keys.add(key);
  }
  return keys;
}

function writeSelectedCatalogues(
  cwd: string,
  memory: Memory,
  config: Config,
  selectedKeys: ReadonlySet<string>,
  prunedKeys: ReadonlySet<string>,
  scoped: boolean,
  prune: boolean,
  transaction: Backup,
): void {
  if (selectedKeys.size === 0 && prunedKeys.size === 0) return;
  const source = sourceCatalog(memory);
  for (const locale of config.locales) {
    const existing = readCatalog(cwd, config, locale);
    if (!scoped) {
      // Always overlay onto the on-disk catalogue. Replacing a file with
      // memory alone drops every key memory happens not to hold — including
      // when an agent slims memory to one feature before running the loop.
      if (locale === config.sourceLocale) {
        const next = { ...existing, ...source };
        for (const key of prunedKeys) delete next[key];
        writeCatalog(
          cwd,
          config,
          locale,
          next,
          (relative) => transaction.capture(relative),
        );
        continue;
      }
      const translated = localeCatalog(memory, locale, false);
      const current = Object.fromEntries(
        Object.entries(source).map(([key, value]) => {
          const approved = translated[key];
          setFallback(memory, key, locale, approved === undefined);
          return [key, approved ?? value];
        }),
      );
      const next = { ...existing, ...current };
      for (const key of prunedKeys) delete next[key];
      writeCatalog(
        cwd,
        config,
        locale,
        next,
        (relative) => transaction.capture(relative),
      );
      continue;
    }

    const renderable: Flat = { ...existing };
    for (const key of prunedKeys) delete renderable[key];
    for (const key of selectedKeys) {
      const sourceValue = source[key];
      if (sourceValue === undefined) continue;
      if (locale === config.sourceLocale) {
        renderable[key] = sourceValue;
        continue;
      }
      const approved = memory.entries[key]?.translations[locale];
      const usable = approved &&
        (approved.status === 'approved' || approved.status === 'manual') &&
        approved.sourceHash === memory.entries[key]!.sourceHash
        ? approved.value
        : undefined;
      renderable[key] = usable ?? sourceValue;
      setFallback(memory, key, locale, usable === undefined);
    }
    writeCatalog(
      cwd,
      config,
      locale,
      renderable,
      (relative) => transaction.capture(relative),
    );
  }
}

function extractionResult(
  filter: ResolvedMessageFilter,
  result: ExtractResult,
  plan: ExtractPlan,
  memory: ExtractLanguageLoopResult['memory'],
): ExtractLanguageLoopResult {
  return {
    schemaVersion: 1,
    apiVersion: CONTENT_LOOP_API_VERSION,
    status: plan.openItems.length
      ? 'open-items'
      : result.applied.length
        ? 'complete'
        : 'no-work',
    filter,
    applied: result.applied,
    skipped: result.skipped,
    filesTouched: result.filesTouched,
    wiringAdded: result.wiringAdded,
    backupId: result.backupId,
    openItems: plan.openItems,
    memory,
  };
}

function marketingSnapshot(
  marketing: MarketingHandoffState,
  selectedUnresolvedKeys: string[],
): LanguageLoopSnapshot['marketing'] {
  return {
    installed: marketing.installed,
    compatible: marketing.compatible,
    unresolvedKeys: [...marketing.unresolvedKeys].sort(),
    selectedUnresolvedKeys,
    ...(marketing.selection ? { selection: marketing.selection } : {}),
  };
}

function emptyResolvedFilter(): ResolvedMessageFilter {
  return {
    requested: { categories: [], groups: [], keys: [] },
    kinds: [],
    selectedKeys: [],
    unmatchedGroups: [],
    unmatchedKeys: [],
  };
}

function emptySnapshot(
  phase: LanguageLoopPhase,
  nextStage: LanguageLoopNextStage,
): LanguageLoopSnapshot {
  return {
    schemaVersion: 1,
    apiVersion: CONTENT_LOOP_API_VERSION,
    phase,
    nextStage,
    filter: emptyResolvedFilter(),
    targetLocales: [],
    hardcoded: 0,
    openItems: 0,
    marketing: {
      installed: false,
      compatible: true,
      unresolvedKeys: [],
      selectedUnresolvedKeys: [],
    },
    progress: [],
  };
}

function blockedSnapshot(error: unknown): LanguageLoopSnapshot {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...emptySnapshot('blocked', code === 'MARKETING_INCOMPATIBLE' ? 'marketing' : 'none'),
    error: { code, message },
  };
}

function errorCode(error: unknown): ContentLoopErrorCode {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    [
      'INVALID_FILTER',
      'FILTER_MISMATCH',
      'INVALID_LOCALE',
      'SELECTION_MISMATCH',
      'INVALID_STATE',
      'MARKETING_INCOMPATIBLE',
    ].includes(error.code)
  ) {
    return error.code as ContentLoopErrorCode;
  }
  return 'INVALID_STATE';
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
