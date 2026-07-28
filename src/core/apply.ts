import path from 'node:path';
import type { Config, Memory } from '../types.js';
import { Backup } from './backup.js';
import { localeCatalog, recordTranslation, sourceCatalog, saveMemory } from './memory.js';
import { readCatalog, writeCatalog, orphanKeys } from './catalog.js';

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

export function applyDecisions(
  cwd: string,
  memory: Memory,
  config: Config,
  decisions: Record<string, Decision>,
  opts: { dryRun?: boolean; prune?: boolean } = {}
): ApplyResult {
  const backup = new Backup(cwd, 'apply');
  let approved = 0;
  let rejected = 0;
  let skippedManual = 0;

  for (const decision of Object.values(decisions)) {
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
  const source = sourceCatalog(memory);

  // The source catalogue is regenerated from memory every time — it is a
  // projection of the code, never something anyone should edit by hand.
  if (!opts.dryRun) {
    written.push(...writeCatalog(cwd, config, config.sourceLocale, source, (rel) => backup.capture(rel)));
  } else {
    written.push(...writeCatalogPaths(config, config.sourceLocale, source));
  }

  for (const locale of config.locales) {
    if (locale === config.sourceLocale) continue;
    const existing = readCatalog(cwd, config, locale);
    const fromMemory = localeCatalog(memory, locale, false);

    // Keys the source no longer has. Reported, and only removed on request —
    // a key can vanish because a component was commented out for an afternoon.
    const dead = orphanKeys(source, existing);
    if (dead.length) orphans[locale] = dead;

    const merged: Record<string, string> = {};
    for (const key of Object.keys(source)) {
      const value = fromMemory[key] ?? existing[key];
      if (value !== undefined) merged[key] = value;
    }
    if (!opts.prune) {
      for (const key of dead) merged[key] = existing[key]!;
    }

    if (!opts.dryRun) {
      written.push(...writeCatalog(cwd, config, locale, merged, (rel) => backup.capture(rel)));
    } else {
      written.push(...writeCatalogPaths(config, locale, merged));
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

function writeCatalogPaths(config: Config, locale: string, flat: Record<string, string>): string[] {
  if (config.layout !== 'namespaced') return [path.posix.join(config.messagesDir, `${locale}.json`)];
  const namespaces = new Set(Object.keys(flat).map((k) => (k.includes('.') ? k.slice(0, k.indexOf('.')) : 'common')));
  return [...namespaces].map((ns) => path.posix.join(config.messagesDir, locale, `${ns}.json`));
}
