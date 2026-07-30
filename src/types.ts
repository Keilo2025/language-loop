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

/** Stable user-facing selectors used by the unified Content Loop facade. */
export type MessageCategory =
  | 'cta'
  | 'button'
  | 'headline'
  | 'navigation'
  | 'label'
  | 'body'
  | 'placeholder'
  | 'accessibility'
  | 'error'
  | 'empty-state'
  | 'meta'
  | 'toast'
  | 'unknown';

/**
 * Omitted means every key. A provided filter is the union of its selectors;
 * an explicitly empty filter intentionally selects no keys.
 */
export interface MessageFilter {
  categories?: MessageCategory[];
  /** Exact stored namespaces, such as "checkout" or "navigation". */
  groups?: string[];
  /** Exact canonical catalogue keys. */
  keys?: string[];
}

export interface ResolvedMessageFilter {
  requested: Required<MessageFilter>;
  /** Canonical Language Loop kinds selected through category aliases. */
  kinds: StringKind[];
  /** Deterministic exact execution scope. */
  selectedKeys: string[];
  unmatchedGroups: string[];
  unmatchedKeys: string[];
}

export interface LanguageProgress {
  locale: string;
  total: number;
  accepted: number;
  pending: number;
  marketingBlocked: number;
  needsHuman: number;
  status: 'pending' | 'waiting-marketing' | 'needs-human' | 'complete';
}

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
    /** Do not translate a key that marketing-loop has an unresolved rewrite for. */
    respectPendingCopy: boolean;
  };
  maxBatch: number;
  ai: {
    /** Maximum generated candidates for one source/locale before human ownership is required. */
    maxAttempts: number;
    /** Wall-clock limit for one provider request. */
    requestTimeoutMs: number;
    /** Additional attempts for transient transport/provider failures. */
    transientRetries: number;
    translator: string;
    judge: string;
    google: {
      project?: string;
      location: string;
      model: string;
    };
    openai: {
      model: string;
      reasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    };
  };
}

export interface MarketingLoopInstallation {
  installed: boolean;
  hasRun: boolean;
  voice?: { tone?: string; person?: string; banned?: string[] };
  audience?: string;
  allowedClaims?: string[];
}

export interface MarketingHandoffEntry {
  key: string;
  file: string;
  sourceHash: string;
  status: 'pending' | 'approved';
}

/** Optional unified-app execution scope carried by the schema-v1 handoff. */
export interface ContentLoopSelection {
  filter: MessageFilter;
  resolvedKeys: string[];
  targetLocales: string[];
}

export interface MarketingHandoff {
  schemaVersion: 1;
  marketingRunId: string;
  scopeDigest: string;
  messagesDir: string;
  sourceLocale: string;
  layout: CatalogLayout;
  unresolved: MarketingHandoffEntry[];
  selection?: ContentLoopSelection;
}

export interface MarketingHandoffState {
  installed: boolean;
  hasRun: boolean;
  compatible: boolean;
  unresolvedKeys: Set<string>;
  selection?: ContentLoopSelection;
  error?: string;
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
  /** Provenance from the scanner. Apply refuses edits without a recognised UI-text context. */
  context: ScannedString['context'];
  /** The scanned UI field name for attribute and literal edits. */
  attr?: string;
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
  /** Translated, waiting for an automated decision. */
  | 'pending'
  /** The automated guardrails and AI judge approved it. */
  | 'approved'
  /** A human edited the catalogue by hand. Never overwritten. */
  | 'manual'
  /** The judge rejected it. Goes back round with the reason attached. */
  | 'rework'
  /** Retry ceiling reached; requires a native-speaking owner or explicit reset. */
  | 'needs-human';

export interface MemoryTranslation {
  value: string;
  /** Hash of the source text this translation was made from. */
  sourceHash: string;
  status: TranslationStatus;
  updatedAt: string;
  /** Who produced it: 'agent' | 'llm:<model>' | 'human' */
  by: string;
  /**
   * How many times this string has been translated and rejected. Reset when the
   * English changes, because that is a different translation problem.
   */
  attempts?: number;
  /** Why the judge rejected the last attempt. Carried into the next brief. */
  judgeNote?: string;
}

export interface MemoryEntry {
  source: string;
  sourceHash: string;
  namespace: string;
  kind: StringKind;
  file: string;
  /** Best-known source occurrence, retained for bounded component context. */
  line?: number;
  component?: string;
  placeholders: string[];
  firstSeen: string;
  lastSeen: string;
  /** Locales whose catalogue value was generated from the source as a safe runtime fallback. */
  fallbackLocales?: string[];
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
  line?: number;
  component?: string;
  placeholders: string[];
  reason: 'new' | 'stale' | 'rework';
  /** The previous translation, when this is a stale or rejected re-translation. */
  previous?: string;
  /** Why the judge sent it back. Only set when reason is 'rework'. */
  judgeNote?: string;
  /** Which attempt this will be. 2 means one has already been rejected. */
  attempt?: number;
}

/** One judge verdict on one translation. */
export interface Verdict {
  key: string;
  locale: string;
  /** False sends it back round with `reason` attached. */
  ok: boolean;
  /** Required when ok is false — this is what the next attempt is told. */
  reason?: string;
}

/** An immutable source/locale unit that crosses translation workflow stages. */
export interface BatchUnit {
  key: string;
  locale: string;
  source: string;
  sourceHash: string;
  contextHash: string;
  kind: StringKind;
  file: string;
  line?: number;
  component?: string;
  placeholders: string[];
  attempt: number;
}

export interface TranslationBatch {
  version: 1;
  id: string;
  createdAt: string;
  sourceLocale: string;
  units: BatchUnit[];
}

export interface TranslationCandidate {
  key: string;
  locale: string;
  value: string;
  note?: string;
  sourceHash: string;
  candidateHash: string;
}

export interface TranslationArtifact {
  version: 1;
  batchId: string;
  producer: string;
  translations: TranslationCandidate[];
}

export interface BoundVerdict extends Verdict {
  sourceHash: string;
  candidateHash: string;
  /** Mechanical failures are persisted without spending a judge request. */
  by?: 'guardrail' | 'judge';
}

export interface VerdictArtifact {
  version: 1;
  batchId: string;
  producer: string;
  verdicts: BoundVerdict[];
}

export interface ComponentContext {
  version: 1;
  key: string;
  locale: string;
  file: string;
  component?: string;
  line?: number;
  startLine: number;
  endLine: number;
  excerpt: string;
  neighborKeys: string[];
  hash: string;
}
