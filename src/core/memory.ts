import type { Config, KeyedString, Memory, MemoryEntry, TranslationStatus, WorkItem } from '../types.js';
import { statePath } from './config.js';
import { readCatalog, type Flat } from './catalog.js';
import { leafOf } from './keys.js';
import { readJsonPrecious, sha, writeJson } from './util.js';

/**
 * What has already been translated, and what has changed since.
 *
 * This file is the reason the loop is cheap to re-run. Without it, every run
 * re-translates the whole app; with it, a run after adding one page translates
 * one page. It lives in git on purpose — the memory belongs to the project,
 * not to whichever laptop happened to run the command.
 */

export const MEMORY_FILE = 'memory.json';

export function loadMemory(cwd: string, sourceLocale: string): Memory {
  const memory = readJsonPrecious<Memory>(statePath(cwd, MEMORY_FILE), {
    version: 1,
    sourceLocale,
    updatedAt: new Date().toISOString(),
    entries: {},
  });
  // A file that parses but holds something other than a memory is still a file
  // we must not overwrite — an empty `entries` here would mean the same silent
  // erasure the strict read exists to prevent.
  if (!memory.entries || typeof memory.entries !== 'object') {
    throw new Error(
      `${statePath(cwd, MEMORY_FILE)} parsed but has no "entries" object.\n` +
        'Restore it from git, or delete it to start over and re-translate everything.'
    );
  }
  return memory;
}

export function saveMemory(cwd: string, memory: Memory): void {
  memory.updatedAt = new Date().toISOString();
  writeJson(statePath(cwd, MEMORY_FILE), memory);
}

/**
 * Fold this run's scan into memory.
 *
 * A source string that changed marks every translation of it stale — the whole
 * point of hashing the source is that "Get started" becoming "Start free" must
 * not leave nine languages quietly saying the old thing.
 */
export function syncMemory(memory: Memory, strings: KeyedString[], config: Config): {
  added: string[];
  changed: string[];
  unchanged: string[];
  disappeared: string[];
} {
  const now = new Date().toISOString();
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();

  for (const s of strings) {
    seen.add(s.key);
    const hash = sha(s.text);
    const existing = memory.entries[s.key];

    if (!existing) {
      memory.entries[s.key] = {
        source: s.text,
        sourceHash: hash,
        namespace: s.namespace,
        kind: s.kind,
        file: s.file,
        placeholders: s.placeholders,
        firstSeen: now,
        lastSeen: now,
        translations: {},
      };
      added.push(s.key);
      continue;
    }

    existing.lastSeen = now;
    existing.file = s.file;
    existing.kind = s.kind;
    existing.placeholders = s.placeholders;

    if (existing.sourceHash !== hash) {
      existing.source = s.text;
      existing.sourceHash = hash;
      for (const translation of Object.values(existing.translations)) {
        // A hand-written translation is still a person's work; mark it stale so
        // it is reviewed, but never silently discard it.
        if (translation.sourceHash !== hash) translation.status = 'stale';
      }
      changed.push(s.key);
    } else {
      unchanged.push(s.key);
    }
  }

  const disappeared = Object.keys(memory.entries).filter((k) => !seen.has(k));
  return { added, changed, unchanged, disappeared };
}

/**
 * Keys memory holds that the code no longer asks for.
 *
 * "Not in this scan" is not the same as "gone": a key that was extracted last
 * run is absent from the scan precisely *because* the loop did its job. Only a
 * key that is neither still hardcoded nor called anywhere is actually dead.
 */
export function deadKeys(memory: Memory, config: Config, usedKeys: Set<string>, stillHardcoded: Set<string>): string[] {
  const scoped = config.runtime === 'next-intl' || config.runtime === 'next-i18next' || config.runtime === 'react-i18next';
  return Object.keys(memory.entries).filter((key) => {
    if (stillHardcoded.has(key)) return false;
    if (usedKeys.has(key)) return false;
    // Namespaced hooks put only the leaf in the code, and paraglide mangles the
    // key into an identifier. Both still count as the key being in use.
    if (scoped && usedKeys.has(leafOf(key))) return false;
    if (usedKeys.has(key.replace(/[.-]/g, '_'))) return false;
    return true;
  });
}

/** Forget keys the code no longer has. Returns what was dropped. */
export function pruneMemory(memory: Memory, keys: string[]): string[] {
  const dropped: string[] = [];
  for (const key of keys) {
    if (memory.entries[key]) {
      delete memory.entries[key];
      dropped.push(key);
    }
  }
  return dropped;
}

/**
 * Pick up edits to the source catalogue.
 *
 * Once `extract` has run, the code holds keys and the English lives in
 * `messages/en.json`. That file becomes the place copy actually gets edited —
 * by a writer, by marketing-loop, by anyone who does not want to open a `.tsx`
 * file. So a changed value there is the real staleness signal, and without
 * this the loop would happily leave nine languages saying last month's thing.
 */
export function adoptSourceEdits(cwd: string, memory: Memory, config: Config): string[] {
  const catalog: Flat = readCatalog(cwd, config, config.sourceLocale);
  const changed: string[] = [];

  for (const [key, value] of Object.entries(catalog)) {
    const entry = memory.entries[key];
    if (!entry || !value.trim() || value === entry.source) continue;
    entry.source = value;
    entry.sourceHash = sha(value);
    for (const translation of Object.values(entry.translations)) {
      if (translation.sourceHash !== entry.sourceHash) translation.status = 'stale';
    }
    changed.push(key);
  }
  return changed;
}

/**
 * Adopt translations a human wrote straight into the catalogue.
 *
 * If someone fixed a clumsy German button by editing messages/de.json, that
 * edit outranks anything the loop would produce. Marking it `manual` locks it.
 */
export function adoptCatalogEdits(cwd: string, memory: Memory, config: Config): number {
  let adopted = 0;
  for (const locale of config.locales) {
    const catalog: Flat = readCatalog(cwd, config, locale);
    for (const [key, value] of Object.entries(catalog)) {
      const entry = memory.entries[key];
      if (!entry || !value.trim()) continue;
      const known = entry.translations[locale];
      if (known && known.value === value) continue;
      entry.translations[locale] = {
        value,
        sourceHash: entry.sourceHash,
        status: 'manual',
        updatedAt: new Date().toISOString(),
        by: 'human',
      };
      adopted++;
    }
  }
  return adopted;
}

/** Everything that still needs a translation, for every target locale. */
export function pendingWork(memory: Memory, config: Config, only?: string[]): WorkItem[] {
  const work: WorkItem[] = [];
  const locales = only?.length ? only : config.locales;

  for (const [key, entry] of Object.entries(memory.entries)) {
    for (const locale of locales) {
      if (locale === config.sourceLocale) continue;
      const t = entry.translations[locale];
      if (!t) {
        work.push({ key, locale, source: entry.source, kind: entry.kind, file: entry.file, placeholders: entry.placeholders, reason: 'new' });
      } else if (t.status === 'stale') {
        work.push({ key, locale, source: entry.source, kind: entry.kind, file: entry.file, placeholders: entry.placeholders, reason: 'stale', previous: t.value });
      }
    }
  }
  return work;
}

export interface MemoryStats {
  keys: number;
  byLocale: Record<string, Record<TranslationStatus, number> & { missing: number; coverage: number }>;
}

export function stats(memory: Memory, config: Config): MemoryStats {
  const byLocale: MemoryStats['byLocale'] = {};
  const total = Object.keys(memory.entries).length;

  for (const locale of config.locales) {
    if (locale === config.sourceLocale) continue;
    const counts = { new: 0, stale: 0, pending: 0, approved: 0, manual: 0, missing: 0, coverage: 0 };
    for (const entry of Object.values(memory.entries)) {
      const t = entry.translations[locale];
      if (!t) counts.missing++;
      else counts[t.status]++;
    }
    const done = counts.approved + counts.manual;
    counts.coverage = total ? Math.round((done / total) * 100) : 0;
    byLocale[locale] = counts;
  }
  return { keys: total, byLocale };
}

/** The source catalogue is generated, never translated — it is the truth. */
export function sourceCatalog(memory: Memory): Flat {
  const flat: Flat = {};
  for (const [key, entry] of Object.entries(memory.entries)) flat[key] = entry.source;
  return flat;
}

export function localeCatalog(memory: Memory, locale: string, includePending: boolean): Flat {
  const flat: Flat = {};
  for (const [key, entry] of Object.entries(memory.entries)) {
    const t = entry.translations[locale];
    if (!t) continue;
    const usable = t.status === 'approved' || t.status === 'manual' || (includePending && t.status === 'pending');
    if (usable) flat[key] = t.value;
  }
  return flat;
}

export function recordTranslation(
  memory: Memory,
  key: string,
  locale: string,
  value: string,
  by: string,
  status: TranslationStatus
): boolean {
  const entry: MemoryEntry | undefined = memory.entries[key];
  if (!entry) return false;
  const existing = entry.translations[locale];
  if (existing?.status === 'manual' && existing.sourceHash === entry.sourceHash) return false;
  entry.translations[locale] = {
    value,
    sourceHash: entry.sourceHash,
    status,
    updatedAt: new Date().toISOString(),
    by,
  };
  return true;
}
