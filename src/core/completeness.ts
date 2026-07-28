import type { Config, TranslationStatus, TranslationUnit } from '../types.js';
import { statePath } from './config.js';
import { readCatalog, orphanKeys } from './catalog.js';
import { checkTranslations } from './guardrails.js';
import { loadMemory, sourceCatalog } from './memory.js';
import { scanKeyUsage, scanRepo } from './scan.js';
import { readJson } from './util.js';

export type FindingKind =
  | 'hardcoded'
  | 'refused'
  | 'missing-source-key'
  | 'missing-translation'
  | 'stale'
  | 'pending'
  | 'approved-unapplied'
  | 'orphan'
  | 'integrity'
  | 'source-copy'
  | 'runtime-locale-gap';

export type SuggestedAction =
  | 'extract'
  | 'manual-extract'
  | 'translate'
  | 'apply'
  | 'retranslate'
  | 'prune'
  | 'setup';

export interface CompletenessFinding {
  kind: FindingKind;
  severity: 'block' | 'warn';
  message: string;
  files: string[];
  locales: string[];
  keys: string[];
  action: SuggestedAction;
}

export interface LocaleCompleteness {
  total: number;
  approved: number;
  manual: number;
  missing: number;
  stale: number;
  pending: number;
  blocked: number;
  coverage: number;
}

export interface CompletenessReport {
  complete: boolean;
  findings: CompletenessFinding[];
  byLocale: Record<string, LocaleCompleteness>;
  actions: SuggestedAction[];
}

const ACTION_ORDER: SuggestedAction[] = [
  'extract',
  'manual-extract',
  'setup',
  'translate',
  'retranslate',
  'apply',
  'prune',
];

export function analyzeCompleteness(cwd: string, config: Config): CompletenessReport {
  const findings: CompletenessFinding[] = [];
  const memory = loadMemory(cwd, config.sourceLocale);
  const scanned = scanRepo(cwd, config);
  const usedKeys = scanKeyUsage(cwd, config);
  const memorySource = sourceCatalog(memory);
  const diskSource = readCatalog(cwd, config, config.sourceLocale);
  const source = { ...memorySource, ...diskSource };
  const sourceEdits = new Set(
    Object.entries(memory.entries)
      .filter(([key, entry]) => diskSource[key]?.trim() && diskSource[key] !== entry.source)
      .map(([key]) => key)
  );

  if (scanned.strings.length) {
    findings.push({
      kind: 'hardcoded',
      severity: 'block',
      message: `${scanned.strings.length} user-facing string(s) are still hardcoded.`,
      files: [...new Set(scanned.strings.map((item) => item.file))],
      locales: [],
      keys: [],
      action: 'extract',
    });
  }

  const openItems = readJson<{ file: string; line: number; text: string; reason: string }[]>(
    statePath(cwd, 'open-items.json'),
    []
  );
  if (openItems.length) {
    findings.push({
      kind: 'refused',
      severity: 'block',
      message: `${openItems.length} string(s) need a manual extraction pattern.`,
      files: [...new Set(openItems.map((item) => item.file))],
      locales: [],
      keys: [],
      action: 'manual-extract',
    });
  }

  const knownKeys = new Set([...Object.keys(source), ...Object.keys(memory.entries)]);
  const missingSourceKeys = [...usedKeys].filter((used) => {
    if (knownKeys.has(used)) return false;
    return ![...knownKeys].some((key) => key.endsWith(`.${used}`) || key.replace(/[.-]/g, '_') === used);
  });
  if (missingSourceKeys.length) {
    findings.push({
      kind: 'missing-source-key',
      severity: 'block',
      message: `${missingSourceKeys.length} translation key(s) used by code are absent from the source catalogue.`,
      files: [],
      locales: [config.sourceLocale],
      keys: missingSourceKeys,
      action: 'setup',
    });
  }

  const byLocale: Record<string, LocaleCompleteness> = {};
  const total = Object.keys(memory.entries).length;

  for (const locale of config.locales) {
    if (locale === config.sourceLocale) continue;
    const target = readCatalog(cwd, config, locale);
    const counts: LocaleCompleteness = {
      total,
      approved: 0,
      manual: 0,
      missing: 0,
      stale: 0,
      pending: 0,
      blocked: 0,
      coverage: 0,
    };
    const missing: string[] = [];
    const stale: string[] = [];
    const pending: string[] = [];
    const unapplied: string[] = [];
    const units: TranslationUnit[] = [];

    for (const [key, entry] of Object.entries(memory.entries)) {
      const translation = entry.translations[locale];
      const catalogValue = target[key];

      if (!translation) {
        if (catalogValue?.trim()) {
          counts.manual++;
        } else {
          counts.missing++;
          missing.push(key);
        }
      } else {
        const effectivelyStale = translation.status === 'stale' || sourceEdits.has(key);
        if (effectivelyStale) {
          counts.stale++;
          stale.push(key);
        } else {
          countStatus(counts, translation.status);
          if (translation.status === 'pending') pending.push(key);
        }
        if (
          !effectivelyStale &&
          (translation.status === 'approved' || translation.status === 'manual') &&
          catalogValue !== translation.value
        ) {
          unapplied.push(key);
        }
      }

      const value = catalogValue?.trim() ? catalogValue : translation?.value;
      if (value) {
        units.push({
          key,
          locale,
          source: source[key] ?? entry.source,
          value,
          kind: entry.kind,
          file: entry.file,
          placeholders: entry.placeholders,
          status: translation?.status ?? 'manual',
        });
      }
    }

    if (missing.length) {
      findings.push(localeFinding(
        'missing-translation',
        'block',
        `${locale} is missing ${missing.length} translation(s).`,
        locale,
        missing,
        'translate'
      ));
    }
    if (stale.length) {
      findings.push(localeFinding(
        'stale',
        'block',
        `${locale} has ${stale.length} stale translation(s).`,
        locale,
        stale,
        'translate'
      ));
    }
    if (pending.length) {
      findings.push(localeFinding(
        'pending',
        'warn',
        `${locale} has ${pending.length} legacy pending translation(s) to return to the autonomous loop.`,
        locale,
        pending,
        'translate'
      ));
    }
    if (unapplied.length) {
      findings.push(localeFinding(
        'approved-unapplied',
        'warn',
        `${locale} has ${unapplied.length} approved translation(s) not present in its catalogue.`,
        locale,
        unapplied,
        'apply'
      ));
    }

    const issues = checkTranslations(units, config);
    const integrityKeys = [...new Set(
      issues.filter((issue) => issue.severity === 'block').map((issue) => issue.key)
    )];
    counts.blocked = integrityKeys.length;
    if (integrityKeys.length) {
      findings.push(localeFinding(
        'integrity',
        'block',
        `${locale} has ${integrityKeys.length} translation(s) that can break at runtime.`,
        locale,
        integrityKeys,
        'retranslate'
      ));
    }

    const sourceCopies = [...new Set(
      issues
        .filter((issue) => issue.rule === 'untranslated')
        .map((issue) => issue.key)
        .filter((key) => !isProtectedSourceCopy(source[key] ?? '', config))
    )];
    if (sourceCopies.length) {
      findings.push(localeFinding(
        'source-copy',
        'warn',
        `${locale} has ${sourceCopies.length} value(s) identical to the source text.`,
        locale,
        sourceCopies,
        'retranslate'
      ));
    }

    const orphans = orphanKeys(source, target);
    if (orphans.length) {
      findings.push(localeFinding(
        'orphan',
        'warn',
        `${locale} has ${orphans.length} catalogue key(s) no longer present in the source.`,
        locale,
        orphans,
        'prune'
      ));
    }

    const done = counts.approved + counts.manual;
    counts.coverage = total ? Math.round((done / total) * 100) : 100;
    byLocale[locale] = counts;
  }

  const actionsPresent = new Set(findings.map((finding) => finding.action));
  const actions = ACTION_ORDER.filter((action) => actionsPresent.has(action));
  const incompleteKinds = new Set<FindingKind>([
    'hardcoded',
    'refused',
    'missing-source-key',
    'missing-translation',
    'stale',
    'pending',
    'approved-unapplied',
    'integrity',
    'runtime-locale-gap',
  ]);
  return {
    complete: !findings.some((finding) => incompleteKinds.has(finding.kind)),
    findings,
    byLocale,
    actions,
  };
}

function localeFinding(
  kind: FindingKind,
  severity: 'block' | 'warn',
  message: string,
  locale: string,
  keys: string[],
  action: SuggestedAction
): CompletenessFinding {
  return { kind, severity, message, files: [], locales: [locale], keys, action };
}

function countStatus(counts: LocaleCompleteness, status: TranslationStatus): void {
  if (status === 'approved') counts.approved++;
  else if (status === 'manual') counts.manual++;
  else if (status === 'stale') counts.stale++;
  else if (status === 'pending') counts.pending++;
  else counts.missing++;
}

function isProtectedSourceCopy(source: string, config: Config): boolean {
  if (!source.trim()) return true;
  if (config.voice.doNotTranslate.some((term) => source.includes(term))) return true;
  if (/^(?:https?:\/\/|[\w.-]+@[\w.-]+$)/.test(source)) return true;
  if (/^[A-Z0-9_.:/-]+$/.test(source)) return true;
  return false;
}
