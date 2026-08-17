import fs from 'node:fs';
import path from 'node:path';
import { exists } from './util.js';

/**
 * Generated state that must never be committed.
 *
 * A double-star prefix covers a root `.language-loop/` and nested ones
 * (`mobile/.language-loop/`) from a single repo-root `.gitignore`.
 */
export const GITIGNORE_ENTRIES = [
  '**/.language-loop/backups/',
  '**/.language-loop/backlog/',
] as const;

export function ensureGitignore(cwd: string): string[] {
  const file = path.join(cwd, '.gitignore');
  const current = exists(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = new Set(
    current.split(/\r?\n/).map((line) => line.trim().replace(/\/$/, ''))
  );
  const added = GITIGNORE_ENTRIES.filter((entry) => !present.has(entry.replace(/\/$/, '')));
  if (!added.length) return [];

  const prefix = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, current + prefix + added.join('\n') + '\n', 'utf8');
  return [...added];
}
