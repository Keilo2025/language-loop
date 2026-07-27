import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../types.js';
import { exists, readJson, writeJson } from './util.js';
import { namespaceOf, leafOf } from './keys.js';

/**
 * The l10n half: the catalogues that fill the skeleton.
 *
 * Everything inside the loop works with a flat `{ "ns.key": "value" }` map,
 * because flat is easy to diff, sort and reason about. Only at the file
 * boundary is it shaped into whatever layout the project's runtime expects.
 */

export type Flat = Record<string, string>;

export function catalogPath(config: Config, locale: string, namespace?: string): string {
  if (config.layout === 'namespaced' && namespace) {
    return path.posix.join(config.messagesDir, locale, `${namespace}.json`);
  }
  return path.posix.join(config.messagesDir, `${locale}.json`);
}

export function readCatalog(cwd: string, config: Config, locale: string): Flat {
  const flat: Flat = {};
  if (config.layout === 'namespaced') {
    const dir = path.join(cwd, config.messagesDir, locale);
    if (!exists(dir)) return flat;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const ns = file.replace(/\.json$/, '');
      const data = readJson<Record<string, unknown>>(path.join(dir, file), {});
      for (const [k, v] of Object.entries(flatten(data))) flat[`${ns}.${k}`] = v;
    }
    return flat;
  }
  const file = path.join(cwd, catalogPath(config, locale));
  if (!exists(file)) return flat;
  return flatten(readJson<Record<string, unknown>>(file, {}));
}

export function writeCatalog(cwd: string, config: Config, locale: string, flat: Flat, capture?: (rel: string) => void): string[] {
  const written: string[] = [];
  if (config.layout === 'namespaced') {
    const byNs = new Map<string, Flat>();
    for (const [key, value] of Object.entries(flat)) {
      const ns = namespaceOf(key);
      if (!byNs.has(ns)) byNs.set(ns, {});
      byNs.get(ns)![leafOf(key)] = value;
    }
    for (const [ns, entries] of byNs) {
      const rel = catalogPath(config, locale, ns);
      capture?.(rel);
      writeJson(path.join(cwd, rel), nest(sortKeys(entries), config.keyStyle));
      written.push(rel);
    }
    return written;
  }
  const rel = catalogPath(config, locale);
  capture?.(rel);
  writeJson(path.join(cwd, rel), nest(sortKeys(flat), config.keyStyle));
  written.push(rel);
  return written;
}

export function flatten(obj: Record<string, unknown>, prefix = ''): Flat {
  const out: Flat = {};
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Record<string, unknown>, full));
    } else if (typeof value === 'string') {
      out[full] = value;
    }
  }
  return out;
}

export function nest(flat: Flat, keyStyle: 'nested' | 'flat'): Record<string, unknown> {
  if (keyStyle === 'flat') return { ...flat };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]!] = value;
  }
  return out;
}

function sortKeys(flat: Flat): Flat {
  return Object.fromEntries(Object.entries(flat).sort(([a], [b]) => a.localeCompare(b)));
}

/** Keys present in the source catalogue but missing from a target locale. */
export function missingKeys(source: Flat, target: Flat): string[] {
  return Object.keys(source).filter((k) => !(k in target) || !target[k]!.trim());
}

/** Keys a locale carries that the source no longer has — dead weight. */
export function orphanKeys(source: Flat, target: Flat): string[] {
  return Object.keys(target).filter((k) => !(k in source));
}
