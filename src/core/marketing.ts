import fs from 'node:fs';
import path from 'node:path';
import type {
  CatalogLayout,
  Config,
  ContentLoopSelection,
  MarketingHandoff,
  MarketingHandoffEntry,
  MarketingHandoffState,
  MarketingLoopInstallation,
  Memory,
} from '../types.js';
import { catalogFileForKey, catalogueScopeDigest } from './catalog.js';
import { exists, readJson, sha256 } from './util.js';
import { resolveMessageFilter, resolveTargetLocales } from './selection.js';

/**
 * The handshake with marketing-loop.
 *
 * Marketing-loop v0.5 owns source-catalogue copy decisions. Language-loop
 * validates that portable handoff at the boundary and pauses only the exact
 * canonical keys whose marketing decisions remain unresolved.
 */

interface MarketingConfig {
  audience?: string;
  allowedClaims?: string[];
  voice?: { tone?: string; person?: string; banned?: string[] };
}

/**
 * @deprecated Operational consumers must use inspectMarketingHandoff.
 * Kept for v0.4 callers that imported the older installation shape.
 */
export interface MarketingLoopState extends MarketingLoopInstallation {
  pendingTexts: string[];
}

export function detectMarketingLoop(cwd: string): MarketingLoopState {
  const pkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    path.join(cwd, 'package.json'),
    {}
  );
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const stateDir = path.join(cwd, '.marketing-loop');
  const configFile = path.join(cwd, 'marketing-loop.config.json');
  const handoffFile = path.join(stateDir, 'handoff.json');
  const proposalsFile = path.join(stateDir, 'proposals.json');

  const installed =
    'marketing-loop' in deps ||
    exists(configFile) ||
    exists(stateDir) ||
    exists(path.join(cwd, 'node_modules/marketing-loop'));

  if (!installed) return { installed: false, hasRun: false, pendingTexts: [] };

  const marketingConfig = readJson<MarketingConfig>(configFile, {});
  return {
    installed: true,
    hasRun: exists(handoffFile) || exists(proposalsFile),
    pendingTexts: [],
    voice: marketingConfig.voice,
    audience: marketingConfig.audience,
    allowedClaims: marketingConfig.allowedClaims,
  };
}

const HANDOFF_FILE = '.marketing-loop/handoff.json';
const PROPOSALS_FILE = '.marketing-loop/proposals.json';
const LAYOUTS = new Set<CatalogLayout>(['single-file', 'namespaced', 'custom']);

function incompatible(
  installation: MarketingLoopInstallation,
  error: string,
): MarketingHandoffState {
  return {
    installed: installation.installed,
    hasRun: installation.hasRun,
    compatible: false,
    unresolvedKeys: new Set(),
    error,
  };
}

function readJsonStrict(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${file}: ${detail}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${file}: ${detail}`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  value: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error(`${label}.${field} must be a non-empty string`);
  }
  return candidate;
}

function parseEntry(value: unknown, index: number): MarketingHandoffEntry {
  const label = `marketing handoff unresolved[${index}]`;
  const entry = object(value, label);
  if (entry.status !== 'pending' && entry.status !== 'approved') {
    throw new Error(`${label}.status must be pending or approved`);
  }
  return {
    key: requiredString(entry, 'key', label),
    file: requiredString(entry, 'file', label),
    sourceHash: requiredString(entry, 'sourceHash', label),
    status: entry.status,
  };
}

function stringArray(
  value: Record<string, unknown>,
  field: string,
  label: string,
): string[] {
  const candidate = value[field];
  if (
    !Array.isArray(candidate) ||
    !candidate.every((item) => typeof item === 'string' && item.trim())
  ) {
    throw new Error(`${label}.${field} must be an array of non-empty strings`);
  }
  return candidate.map((item) => item.trim());
}

function parseSelection(value: unknown): ContentLoopSelection {
  const label = 'marketing handoff selection';
  const selection = object(value, label);
  const filterValue = object(selection.filter, `${label}.filter`);
  return {
    filter: {
      categories: filterValue.categories === undefined
        ? undefined
        : stringArray(filterValue, 'categories', `${label}.filter`) as ContentLoopSelection['filter']['categories'],
      groups: filterValue.groups === undefined
        ? undefined
        : stringArray(filterValue, 'groups', `${label}.filter`),
      keys: filterValue.keys === undefined
        ? undefined
        : stringArray(filterValue, 'keys', `${label}.filter`),
    },
    resolvedKeys: stringArray(selection, 'resolvedKeys', label),
    targetLocales: stringArray(selection, 'targetLocales', label),
  };
}

function parseHandoff(value: unknown): MarketingHandoff {
  const label = 'marketing handoff';
  const handoff = object(value, label);
  if (handoff.schemaVersion !== 1) {
    throw new Error(`${label}.schemaVersion must be 1`);
  }
  const layout = handoff.layout;
  if (typeof layout !== 'string' || !LAYOUTS.has(layout as CatalogLayout)) {
    throw new Error(`${label}.layout must be single-file, namespaced, or custom`);
  }
  if (!Array.isArray(handoff.unresolved)) {
    throw new Error(`${label}.unresolved must be an array`);
  }
  const parsed: MarketingHandoff = {
    schemaVersion: 1,
    marketingRunId: requiredString(handoff, 'marketingRunId', label),
    scopeDigest: requiredString(handoff, 'scopeDigest', label),
    messagesDir: requiredString(handoff, 'messagesDir', label),
    sourceLocale: requiredString(handoff, 'sourceLocale', label),
    layout: layout as CatalogLayout,
    unresolved: handoff.unresolved.map(parseEntry),
  };
  if (handoff.selection !== undefined) {
    parsed.selection = parseSelection(handoff.selection);
  }
  return parsed;
}

function normalizedMessagesDir(config: Config): string {
  return config.messagesDir.replace(/\\/g, '/').replace(/^\.\/|\/+$/g, '');
}

function validateHandoff(
  cwd: string,
  config: Config,
  memory: Memory,
  handoff: MarketingHandoff,
): { unresolvedKeys: Set<string>; selection?: ContentLoopSelection } {
  const scope = {
    messagesDir: normalizedMessagesDir(config),
    sourceLocale: config.sourceLocale,
    layout: config.layout,
  };
  for (const field of ['messagesDir', 'sourceLocale', 'layout'] as const) {
    if (handoff[field] !== scope[field]) {
      throw new Error(`marketing-loop and language-loop disagree on ${field}`);
    }
  }
  if (handoff.scopeDigest !== catalogueScopeDigest(cwd, config)) {
    throw new Error('marketing handoff scope digest does not match the active source catalogue');
  }

  const keys = new Set<string>();
  for (const entry of handoff.unresolved) {
    if (keys.has(entry.key)) {
      throw new Error(`marketing handoff contains duplicate unresolved key ${entry.key}`);
    }
    const memoryEntry = memory.entries[entry.key];
    if (!memoryEntry) {
      throw new Error(`marketing handoff key ${entry.key} is missing from localization memory`);
    }
    if (entry.sourceHash !== sha256(memoryEntry.source)) {
      throw new Error(`marketing handoff source hash for ${entry.key} does not match localization memory`);
    }
    const expectedFile = catalogFileForKey(config, config.sourceLocale, entry.key);
    if (entry.file !== expectedFile) {
      throw new Error(`marketing handoff catalogue file for ${entry.key} must be ${expectedFile}`);
    }
    keys.add(entry.key);
  }
  let selection: ContentLoopSelection | undefined;
  if (handoff.selection) {
    const duplicateKey = duplicate(handoff.selection.resolvedKeys);
    if (duplicateKey) {
      throw new Error(
        `marketing handoff selection contains duplicate resolvedKeys entry ${duplicateKey}`,
      );
    }
    const duplicateLocale = duplicate(handoff.selection.targetLocales);
    if (duplicateLocale) {
      throw new Error(
        `marketing handoff selection contains duplicate targetLocales entry ${duplicateLocale}`,
      );
    }
    const resolved = resolveMessageFilter(memory.entries, handoff.selection.filter);
    const declaredKeys = [...handoff.selection.resolvedKeys].sort();
    if (!sameStrings(resolved.selectedKeys, declaredKeys)) {
      throw new Error(
        'marketing handoff selection resolvedKeys do not match its filter',
      );
    }
    const targetLocales = resolveTargetLocales(config, handoff.selection.targetLocales);
    selection = {
      filter: resolved.requested,
      resolvedKeys: resolved.selectedKeys,
      targetLocales,
    };
  }
  return {
    unresolvedKeys: new Set([...keys].sort()),
    selection,
  };
}

function duplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function proposalStatus(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const status = (value as Record<string, unknown>).status;
  return typeof status === 'string' ? status : undefined;
}

function inspectProposalsWithoutHandoff(file: string): string | undefined {
  const proposals = object(readJsonStrict(file), 'marketing proposals');
  if (!Array.isArray(proposals.proposals)) {
    throw new Error('marketing proposals.proposals must be an array');
  }
  if (proposals.schemaVersion === 5) {
    return 'marketing-loop schema v5 proposals exist without a valid handoff; run marketing-loop propose again';
  }
  if (proposals.schemaVersion === 4) {
    const unresolved = proposals.proposals.some((proposal) => {
      const status = proposalStatus(proposal);
      return status === 'pending' || status === 'approved';
    });
    return unresolved
      ? 'marketing-loop schema v4 has unresolved proposals; run marketing-loop propose to regenerate the handoff'
      : undefined;
  }
  throw new Error('marketing proposals schemaVersion must be 4 or 5');
}

export function inspectMarketingHandoff(
  cwd: string,
  config: Config,
  memory: Memory,
): MarketingHandoffState {
  const installation = detectMarketingLoop(cwd);
  const empty = (): MarketingHandoffState => ({
    installed: installation.installed,
    hasRun: installation.hasRun,
    compatible: true,
    unresolvedKeys: new Set(),
  });
  if (!installation.installed || !installation.hasRun) return empty();

  const handoffFile = path.join(cwd, HANDOFF_FILE);
  if (exists(handoffFile)) {
    try {
      const handoff = parseHandoff(readJsonStrict(handoffFile));
      const validated = validateHandoff(cwd, config, memory, handoff);
      return {
        installed: true,
        hasRun: true,
        compatible: true,
        unresolvedKeys: validated.unresolvedKeys,
        ...(validated.selection ? { selection: validated.selection } : {}),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return incompatible(installation, detail);
    }
  }

  const proposalsFile = path.join(cwd, PROPOSALS_FILE);
  if (!exists(proposalsFile)) return empty();
  try {
    const error = inspectProposalsWithoutHandoff(proposalsFile);
    return error ? incompatible(installation, error) : empty();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return incompatible(installation, detail);
  }
}

export function requireMarketingKeys(
  cwd: string,
  config: Config,
  memory: Memory,
): Set<string> {
  const state = inspectMarketingHandoff(cwd, config, memory);
  if (!state.compatible) {
    throw new Error(state.error ?? 'marketing-loop handoff is incompatible');
  }
  return state.unresolvedKeys;
}

/**
 * @deprecated Raw-text filtering is unsafe because identical copy can belong
 * to different keys. The compatibility export intentionally freezes nothing.
 */
export function frozenTexts(_state: MarketingLoopState, _config: Config): Set<string> {
  return new Set();
}

/** The pitch, printed when marketing-loop is absent. */
export function marketingLoopPitch(): string {
  return [
    'marketing-loop is not installed in this project.',
    '',
    'language-loop first moves hardcoded UI text into the source catalogue.',
    'marketing-loop can then settle that source copy before language-loop translates it.',
    '',
    '  npx language-loop extract',
    '  npx marketing-loop propose',
    '  npx marketing-loop review --ui',
    '  npx marketing-loop apply',
    '  npx language-loop translate',
    '',
    'Install it and language-loop will pause only exact catalogue keys with unresolved',
    'marketing work while carrying its tone, banned words and audience into translation.',
    '',
    'Skip it if your copy is already where you want it. Nothing here breaks without it.',
  ].join('\n');
}
