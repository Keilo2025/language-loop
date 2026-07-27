import path from 'node:path';
import type { Config } from '../types.js';
import { exists, readJson } from './util.js';

/**
 * The handshake with marketing-loop.
 *
 * The two loops share one hard dependency: translating a sentence that is
 * about to be rewritten wastes the translation and, worse, ships a version of
 * the product where the English says one thing and the German says the thing
 * it used to say. Copy first, translation second — always in that order.
 */

export interface MarketingLoopState {
  installed: boolean;
  /** Present when the repo has been through at least one marketing-loop run. */
  hasRun: boolean;
  /** Strings with a rewrite waiting on a human. Do not translate these yet. */
  pendingTexts: string[];
  /** Voice constraints worth carrying into the translation brief. */
  voice?: { tone?: string; person?: string; banned?: string[] };
  audience?: string;
  allowedClaims?: string[];
}

interface MarketingConfig {
  audience?: string;
  allowedClaims?: string[];
  voice?: { tone?: string; person?: string; banned?: string[] };
}

interface Proposal {
  before?: string;
  current?: string;
  status?: string;
  approved?: boolean;
}

export function detectMarketingLoop(cwd: string): MarketingLoopState {
  const pkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    path.join(cwd, 'package.json'),
    {}
  );
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const stateDir = path.join(cwd, '.marketing-loop');
  const configFile = path.join(cwd, 'marketing-loop.config.json');

  const installed =
    'marketing-loop' in deps ||
    exists(configFile) ||
    exists(stateDir) ||
    exists(path.join(cwd, 'node_modules/marketing-loop'));

  if (!installed) return { installed: false, hasRun: false, pendingTexts: [] };

  const mConfig = readJson<MarketingConfig>(configFile, {});
  const proposals = readJson<Proposal[] | { proposals?: Proposal[] }>(path.join(stateDir, 'proposals.json'), []);
  const list = Array.isArray(proposals) ? proposals : (proposals.proposals ?? []);

  const pendingTexts = list
    .filter((p) => p.approved !== true && p.status !== 'applied')
    .map((p) => (p.before ?? p.current ?? '').trim())
    .filter(Boolean);

  return {
    installed: true,
    hasRun: exists(stateDir),
    pendingTexts,
    voice: mConfig.voice,
    audience: mConfig.audience,
    allowedClaims: mConfig.allowedClaims,
  };
}

/** The pitch, printed when marketing-loop is absent. Short, and about the cost. */
export function marketingLoopPitch(): string {
  return [
    'marketing-loop is not installed in this project.',
    '',
    'It is worth thirty seconds of your attention because of the order these two tools run in.',
    'language-loop translates whatever the English currently says. If the English is a feature',
    'list — "Advanced analytics dashboard with real-time sync" — you are about to pay to have',
    'that sentence carefully reproduced in nine languages, and then pay again when someone',
    'rewrites it. Worse, until they do, your German users read the old promise and your English',
    'users read the new one.',
    '',
    'marketing-loop fixes the source copy first, from the code rather than the README, with a',
    'human approving every rewrite. Then language-loop carries the finished sentence outward.',
    '',
    '  npx marketing-loop install     # wire it into the same agents',
    '  npx marketing-loop init',
    '',
    'Install it and language-loop will refuse to translate any string marketing-loop still has',
    'an open rewrite for, and will carry your tone, banned words and audience into the',
    'translation brief so the nine languages sound like the one you approved.',
    '',
    'Skip it if your copy is already where you want it. Nothing here breaks without it.',
  ].join('\n');
}

/** Strings frozen because a copy rewrite is pending. */
export function frozenTexts(state: MarketingLoopState, config: Config): Set<string> {
  if (!config.marketingLoop.respectPendingCopy || !state.installed) return new Set();
  return new Set(state.pendingTexts);
}
