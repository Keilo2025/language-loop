import path from 'node:path';
import type { Config, Detection } from '../types.js';
import { exists, readJson, writeJson } from './util.js';

export const CONFIG_FILE = 'language-loop.config.json';
export const STATE_DIR = '.language-loop';

export function defaultConfig(detection: Detection): Config {
  const sourceIncludes = [
    '**/*.tsx', '**/*.jsx', '**/*.ts', '**/*.js',
    '**/*.vue', '**/*.svelte', '**/*.astro',
  ];
  if (detection.framework === 'html') sourceIncludes.push('**/*.html');

  return {
    sourceLocale: 'en',
    locales: [],
    runtime: detection.runtime,
    framework: detection.framework,
    messagesDir: detection.messagesDir,
    layout: detection.layout,
    include: sourceIncludes,
    exclude: [
      '**/*.test.*', '**/*.spec.*', '**/*.stories.*', '**/*.d.ts',
      '**/*.config.*', '**/scripts/**', '**/tests/**', '**/__tests__/**',
      '**/generated/**', '**/__generated__/**', '**/*.generated.*',
      '**/locales/**', '**/locales.*', '**/locale-catalog.*',
      '**/prototypes/**', '**/prototype/**',
      // Docs, skills, requirement docs, handoffs and agent-instruction dirs
      // instruct humans and agents; they are not interface copy. The scan
      // boundary blocks the same paths unconditionally, so removing them
      // here does not opt them back in.
      '**/docs/**', '**/doc/**', '**/documentation/**',
      '**/skills/**', '**/skill/**', '**/prd/**', '**/brd/**', '**/handoff/**',
      '**/.agents/**', '**/.claude/**', '**/.cursor/**', '**/.codex/**',
      '**/*.md', '**/*.mdx', '**/*.toml',
    ],
    protectedFiles: ['LICENSE', 'CHANGELOG.md', 'README.md'],
    ignoreStrings: [],
    keyStyle: 'nested',
    maxLengthRatio: 2.0,
    voice: {
      tone: 'plain and direct — say what the thing does, do not sell it',
      formality: 'auto',
      doNotTranslate: [],
      glossary: {},
    },
    agents: [],
    marketingLoop: { enabled: false, respectPendingCopy: true },
    maxBatch: 200,
    ai: {
      maxAttempts: 2,
      requestTimeoutMs: 30_000,
      transientRetries: 2,
      translator: 'google-tllm',
      judge: 'openai-gpt-5.6-terra',
      google: {
        location: 'global',
        model: 'general/translation-llm',
      },
      openai: {
        model: 'gpt-5.6-terra',
        reasoningEffort: 'low',
      },
    },
  };
}

export function loadConfig(cwd: string): Config | null {
  const file = path.join(cwd, CONFIG_FILE);
  if (!exists(file)) return null;
  const raw = readJson<Partial<Config>>(file, {});
  const base = defaultConfig({
    framework: 'unknown',
    runtime: 'plain',
    messagesDir: 'locales',
    layout: 'single-file',
    srcDir: '.',
    runtimeInstalled: false,
    evidence: [],
  });
  return {
    ...base,
    ...raw,
    voice: { ...base.voice, ...(raw.voice ?? {}) },
    marketingLoop: { ...base.marketingLoop, ...(raw.marketingLoop ?? {}) },
    ai: {
      ...base.ai,
      ...(raw.ai ?? {}),
      google: { ...base.ai.google, ...(raw.ai?.google ?? {}) },
      openai: { ...base.ai.openai, ...(raw.ai?.openai ?? {}) },
    },
  } as Config;
}

export function saveConfig(cwd: string, config: Config): void {
  writeJson(path.join(cwd, CONFIG_FILE), config);
}

export function statePath(cwd: string, ...parts: string[]): string {
  return path.join(cwd, STATE_DIR, ...parts);
}

/**
 * Every command except `init` needs a config. Failing here with a sentence
 * that says what to run next is worth more than a stack trace.
 */
export function requireConfig(cwd: string): Config {
  const config = loadConfig(cwd);
  if (!config) {
    throw new Error(
      `No ${CONFIG_FILE} in this directory.\n` +
        `Run  npx language-loop init  first — it asks which agent you use and which languages you want.`
    );
  }
  if (!config.locales.length) {
    throw new Error(
      `${CONFIG_FILE} has no target languages.\n` +
        `Add them to "locales", or re-run  npx language-loop init.`
    );
  }
  return config;
}
