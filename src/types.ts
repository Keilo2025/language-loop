/**
 * Shared types for the language loop.
 *
 * i18n is the skeleton: the code stops holding words and starts holding keys.
 * l10n is the skin: the catalogues that fill those keys, one per locale.
 * Every type below belongs to one of those two halves.
 */

export type StringKind =
  | 'heading'
  | 'cta'
  | 'label'
  | 'placeholder'
  | 'alt'
  | 'title'
  | 'aria'
  | 'error'
  | 'empty-state'
  | 'body'
  | 'nav'
  | 'meta'
  | 'toast'
  | 'unknown';

export type Runtime =
  | 'next-intl'
  | 'next-i18next'
  | 'react-i18next'
  | 'vue-i18n'
  | 'svelte-i18n'
  | 'paraglide'
  | 'plain';

export type Framework =
  | 'next-app'
  | 'next-pages'
  | 'react'
  | 'vue'
  | 'nuxt'
  | 'svelte'
  | 'sveltekit'
  | 'astro'
  | 'html'
  | 'unknown';

export type CatalogLayout =
  /** messages/en.json — one file per locale, keys nested by namespace */
  | 'single-file'
  /** locales/en/common.json — one file per locale per namespace */
  | 'namespaced'
  /** src/locales/en.json */
  | 'custom';

export interface Detection {
  framework: Framework;
  runtime: Runtime;
  /** Directory that holds the catalogues, relative to cwd. */
  messagesDir: string;
  layout: CatalogLayout;
  srcDir: string;
  /** True when the runtime package is present in package.json. */
  runtimeInstalled: boolean;
  /** Human-readable evidence for every conclusion above. */
  evidence: string[];
}

export interface VoiceConfig {
  /** e.g. "plain, warm, second person — never sales-y" */
  tone: string;
  /** 'formal' | 'informal' | 'auto' — drives du/Sie, tu/vous, tú/usted */
  formality: 'formal' | 'informal' | 'auto';
  /** Terms that must survive translation untouched. Brand names, product nouns. */
  doNotTranslate: string[];
  /** source term -> per-locale required translation. Enforced by guardrails. */
  glossary: Record<string, Record<string, string>>;
}

export interface Config {
  sourceLocale: string;
  locales: string[];
  runtime: Runtime;
  framework: Framework;
  messagesDir: string;
  layout: CatalogLayout;
  include: string[];
  exclude: string[];
  /** Files the extractor must never rewrite. */
  protectedFiles: string[];
  /** Strings matching any of these are treated as technical, never extracted. */
  ignoreStrings: string[];
  keyStyle: 'nested' | 'flat';
  /** Max characters a translation may exceed the source by, as a ratio, for tight UI kinds. */
  maxLengthRatio: number;
  voice: VoiceConfig;
  agents: string[];
  marketingLoop: {
    enabled: boolean;
    /** Do not translate a string that marketing-loop has an open proposal for. */
    respectPendingCopy: boolean;
  };
  maxBatch: number;
}

export interface ScannedString {
  /** Absolute-from-cwd path, POSIX separators. */
  file: string;
  line: number;
  /** The literal source text, already unescaped. */
  text: string;
  kind: StringKind;
  /** How it sits in the file — decides how the extractor rewrites it. */
  context: 'jsx-text' | 'jsx-attr' | 'vue-text' | 'vue-attr' | 'html-text' | 'html-attr' | 'literal';
  /** For attributes: the attribute name. */
  attr?: string;
  /** The exact substring that must be replaced, for exact-match safety. */
  raw: string;
  /** Enclosing component or function name, when we could work it out. */
  component?: string;
  /**
   * Module scope means the string sits outside every function body, so a hook
   * result like `t` cannot legally be referenced from it.
   */
  scope?: 'module' | 'nested';
  /** ICU-style placeholders detected inside the text. */
  placeholders: string[];
}

export interface KeyedString extends ScannedString {
  key: string;
  namespace: string;
}

export interface Edit {
  file: string;
  line: number;
  before: string;
  after: string;
  key: string;
  reason: string;
}

export type TranslationStatus =
  /** Never translated. */
  | 'new'
  /** Source text changed since this translation was made. */
  | 'stale'
  /** Translated, waiting on a human. */
  | 'pending'
  /** A human approved it. */
  | 'approved'
  /** A human edited the catalogue by hand. Never overwritten. */
  | 'manual';

export interface MemoryTranslation {
  value: string;
  /** Hash of the source text this translation was made from. */
  sourceHash: string;
  status: TranslationStatus;
  updatedAt: string;
  /** Who produced it: 'agent' | 'llm:<model>' | 'human' */
  by: string;
}

export interface MemoryEntry {
  source: string;
  sourceHash: string;
  namespace: string;
  kind: StringKind;
  file: string;
  placeholders: string[];
  firstSeen: string;
  lastSeen: string;
  translations: Record<string, MemoryTranslation>;
}

export interface Memory {
  version: 1;
  sourceLocale: string;
  updatedAt: string;
  entries: Record<string, MemoryEntry>;
}

export interface TranslationUnit {
  key: string;
  locale: string;
  source: string;
  value: string;
  kind: StringKind;
  file: string;
  placeholders: string[];
  status: TranslationStatus;
  notes?: string;
}

export interface GuardrailIssue {
  key: string;
  locale: string;
  rule: string;
  severity: 'block' | 'flag';
  message: string;
}

export interface WorkItem {
  key: string;
  locale: string;
  source: string;
  kind: StringKind;
  file: string;
  placeholders: string[];
  reason: 'new' | 'stale';
  /** The previous translation, when this is a stale re-translation. */
  previous?: string;
}
