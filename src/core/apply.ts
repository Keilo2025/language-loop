import path from 'node:path';
import type { Config, Memory } from '../types.js';
import { Backup } from './backup.js';
import { localeCatalog, recordTranslation, sourceCatalog, saveMemory } from './memory.js';
import { readCatalog, writeCatalog, orphanKeys } from './catalog.js';
import { namespaceOf } from './keys.js';

/**
 * Write the catalogues.
 *
 * Only accepted translations get through, and only into catalogue files —
 * `apply` never touches source code. Automatic intake accepts guardrail-clean
 * entries approved by the AI judge.
 */

export interface Decision {
  key: string;
  locale: string;
  approved: boolean;
  value: string;
  editedByHuman: boolean;
}

export interface ApplyResult {
  written: string[];
  approved: number;
  rejected: number;
  skippedManual: number;
  orphans: Record<string, string[]>;
  backupId: string | null;
}

export interface ApplyOptions {
  dryRun?: boolean;
  prune?: boolean;
  /** Exact canonical keys this apply may update. Omitted preserves legacy all-key behavior. */
  keys?: ReadonlySet<string>;
  /** Exact target locales this apply may write. Omitted preserves legacy all-locale behavior. */
  locales?: ReadonlySet<string>;
}

export function applyDecisions(
  cwd: string,
  memory: Memory,
  config: Config,
  decisions: Record<string, Decision>,
  opts: ApplyOptions = {}
): ApplyResult {
  const backup = new Backup(cwd, 'apply');
  let approved = 0;
  let rejected = 0;
  let skippedManual = 0;

  for (const decision of Object.values(decisions)) {
    if (opts.keys && !opts.keys.has(decision.key)) {
      throw new Error(`Refusing to apply out-of-scope canonical key ${decision.key}`);
    }
    if (opts.locales && !opts.locales.has(decision.locale)) {
      throw new Error(`Refusing to apply out-of-scope target locale ${decision.locale}`);
    }
    if (!decision.approved) {
      rejected++;
      continue;
    }
    const ok = recordTranslation(
      memory,
      decision.key,
      decision.locale,
      decision.value,
      decision.editedByHuman ? 'human' : 'agent',
      decision.editedByHuman ? 'manual' : 'approved'
    );
    if (ok) approved++;
    else skippedManual++;
  }

  const written: string[] = [];
  const orphans: Record<string, string[]> = {};
  const completeSource = sourceCatalog(memory);
  const existingSource = readCatalog(cwd, config, config.sourceLocale);
  const source = opts.keys
    ? mergeSelected(existingSource, completeSource, opts.keys, opts.prune ?? false)
    : completeSource;
  const hasSelectedKeys = !opts.keys || opts.keys.size > 0;

  // The source catalogue is regenerated from memory every time — it is a
  // projection of the code, never something anyone should edit by hand. A
  // selected Content Loop run updates only its exact keys and namespaces.
  if (hasSelectedKeys) {
    const output = catalogueWriteView(config, source, opts.keys);
    if (!opts.dryRun) {
      written.push(...writeCatalog(
        cwd,
        config,
        config.sourceLocale,
        output,
        (rel) => backup.capture(rel),
      ));
    } else {
      written.push(...writeCatalogPaths(config, config.sourceLocale, output));
    }
  }

  for (const locale of config.locales) {
    if (locale === config.sourceLocale) continue;
    if (opts.locales && !opts.locales.has(locale)) continue;
    const existing = readCatalog(cwd, config, locale);
    const fromMemory = localeCatalog(memory, locale, false);

    // Keys the source no longer has. Reported, and only removed on request —
    // a key can vanish because a component was commented out for an afternoon.
    const dead = orphanKeys(completeSource, existing)
      .filter((key) => !opts.keys || opts.keys.has(key));
    if (dead.length) orphans[locale] = dead;

    const merged = opts.keys
      ? mergeSelected(existing, fromMemory, opts.keys, opts.prune ?? false)
      : mergeComplete(completeSource, existing, fromMemory, dead, opts.prune ?? false);
    if (!hasSelectedKeys) continue;
    const output = catalogueWriteView(config, merged, opts.keys);

    if (!opts.dryRun) {
      written.push(...writeCatalog(cwd, config, locale, output, (rel) => backup.capture(rel)));
    } else {
      written.push(...writeCatalogPaths(config, locale, output));
    }
  }

  if (!opts.dryRun) saveMemory(cwd, memory);

  return {
    written: [...new Set(written)],
    approved,
    rejected,
    skippedManual,
    orphans,
    backupId: opts.dryRun ? null : backup.commit(),
  };
}

function mergeSelected(
  existing: Record<string, string>,
  values: Record<string, string>,
  keys: ReadonlySet<string>,
  prune: boolean,
): Record<string, string> {
  const merged = { ...existing };
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined) merged[key] = value;
    else if (prune) delete merged[key];
  }
  return merged;
}

function mergeComplete(
  source: Record<string, string>,
  existing: Record<string, string>,
  fromMemory: Record<string, string>,
  dead: readonly string[],
  prune: boolean,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    const value = fromMemory[key] ?? existing[key];
    if (value !== undefined) merged[key] = value;
  }
  if (!prune) {
    for (const key of dead) merged[key] = existing[key]!;
  }
  return merged;
}

function catalogueWriteView(
  config: Config,
  catalog: Record<string, string>,
  keys?: ReadonlySet<string>,
): Record<string, string> {
  if (config.layout !== 'namespaced' || !keys) return catalog;
  const namespaces = new Set([...keys].map(namespaceOf));
  return Object.fromEntries(
    Object.entries(catalog).filter(([key]) => namespaces.has(namespaceOf(key))),
  );
}

function writeCatalogPaths(config: Config, locale: string, flat: Record<string, string>): string[] {
  if (config.layout !== 'namespaced') return [path.posix.join(config.messagesDir, `${locale}.json`)];
  const namespaces = new Set(Object.keys(flat).map(namespaceOf));
  return [...namespaces].map((ns) => path.posix.join(config.messagesDir, locale, `${ns}.json`));
}
