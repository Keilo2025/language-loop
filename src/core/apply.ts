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

  // Scope which keys this apply may touch. Prefer an explicit filter, then the
  // keys in the decision set, then every key memory knows about. Always overlay
  // onto the on-disk catalogues — memory is not a complete inventory (agents
  // regularly slim it to one feature), so replacing a file with memory alone
  // wiped sibling namespaces like Dashboard next to FinancialScore.
  const decidedKeys = new Set(
    Object.values(decisions).filter((decision) => decision.approved).map((decision) => decision.key)
  );
  const keysToUpdate = opts.keys
    ?? (decidedKeys.size > 0 ? decidedKeys : new Set(Object.keys(completeSource)));
  const namespaceScope = opts.keys ?? (decidedKeys.size > 0 ? decidedKeys : undefined);

  if (keysToUpdate.size > 0) {
    const source = mergeSelected(
      existingSource,
      completeSource,
      keysToUpdate,
      opts.prune ?? false,
    );
    const output = catalogueWriteView(config, source, namespaceScope);
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
    // "Not in memory" is not the same as "dead": a slimmed memory must never
    // mark the rest of the catalogue as orphaned.
    const dead = orphanKeys(completeSource, existing)
      .filter((key) => keysToUpdate.has(key));
    if (dead.length) orphans[locale] = dead;

    if (!keysToUpdate.size) continue;
    const merged = mergeSelected(existing, fromMemory, keysToUpdate, opts.prune ?? false);
    const output = catalogueWriteView(config, merged, namespaceScope);

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
