import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha(text: string): string {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16);
}

export function posix(p: string): string {
  return p.split(path.sep).join('/');
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

const ALWAYS_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  'coverage', '.turbo', '.vercel', '.cache', 'vendor', '.language-loop', '.marketing-loop',
  'public', 'static', '__snapshots__',
]);

export interface WalkOptions {
  include?: string[];
  exclude?: string[];
  extensions?: string[];
  limit?: number;
}

/**
 * Walk the tree and hand back files worth reading.
 *
 * Deliberately conservative: anything under a build or dependency directory is
 * skipped without being read, because a scan that takes a minute is a scan
 * nobody runs twice.
 */
export function walk(root: string, opts: WalkOptions = {}): string[] {
  const exts = new Set(opts.extensions ?? []);
  const exclude = (opts.exclude ?? []).map((g) => globToRegExp(g));
  const include = (opts.include ?? []).map((g) => globToRegExp(g));
  const limit = opts.limit ?? 20000;
  const found: string[] = [];

  const stack = [root];
  while (stack.length && found.length < limit) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = posix(path.relative(root, full));
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        if (exclude.some((r) => r.test(rel + '/'))) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (exts.size && !exts.has(path.extname(entry.name))) continue;
      if (exclude.some((r) => r.test(rel))) continue;
      if (include.length && !include.some((r) => r.test(rel))) continue;
      found.push(rel);
    }
  }
  return found.sort();
}

/** Minimal glob support: **, *, ? — enough for include/exclude lists. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$+.()|[]{}'.includes(c!)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp('^' + out + '$');
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function relTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function truncate(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, n - 1) + '…';
}
