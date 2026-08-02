import fs from 'node:fs';
import path from 'node:path';
import { exists } from './util.js';

export interface DotEnvResult {
  file: string;
  /** Names actually applied — variables already in the environment are left alone. */
  keys: string[];
}

/**
 * Minimal dotenv parser: KEY=value, optional `export`, single/double quotes,
 * whole-line and inline comments on unquoted values. Double-quoted values
 * expand \n and \r; single-quoted values stay literal. No multi-line values —
 * the variables this loads (API keys, project ids) are single-line by nature.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2] ?? '';
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(' #');
      if (comment !== -1) value = value.slice(0, comment);
      value = value.trim();
    }
    out[match[1]!] = value;
  }
  return out;
}

/**
 * Load `<cwd>/.env` into the environment so the LLM providers find their keys
 * without shell plumbing. Variables already set win — CI secrets and real
 * shells must never be overridden by a file that got committed by mistake.
 * Returns null when the project has no .env; that is the normal case, not an
 * error.
 */
export function loadDotEnv(cwd: string, env: NodeJS.ProcessEnv = process.env): DotEnvResult | null {
  const file = path.join(cwd, '.env');
  if (!exists(file)) return null;
  const parsed = parseDotEnv(fs.readFileSync(file, 'utf8'));
  const keys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    keys.push(key);
  }
  return { file, keys };
}
