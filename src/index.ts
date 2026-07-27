/**
 * Programmatic access to every stage of the loop.
 *
 * The stages are exported separately on purpose: the loop drops into CI, a git
 * hook or an MCP server one piece at a time. The one thing not to automate
 * away is the approval gate — a translation nobody read is a translation
 * nobody is accountable for.
 */

export type {
  Config, Detection, Memory, MemoryEntry, MemoryTranslation, ScannedString, KeyedString,
  TranslationUnit, GuardrailIssue, WorkItem, StringKind, Runtime, Framework, CatalogLayout,
} from './types.js';

export { detect, callExpression, hookFor } from './core/detect.js';
export { loadConfig, saveConfig, defaultConfig, requireConfig, CONFIG_FILE, STATE_DIR } from './core/config.js';
export { scanRepo, isCopy, findPlaceholders } from './core/scan.js';
export { assignKeys, namespaceFor, slugFor, leafOf, namespaceOf } from './core/keys.js';
export { planExtraction, applyExtraction } from './core/extract.js';
export {
  loadMemory, saveMemory, syncMemory, pendingWork, stats, sourceCatalog, localeCatalog,
  recordTranslation, adoptCatalogEdits, adoptSourceEdits,
} from './core/memory.js';
export { readCatalog, writeCatalog, flatten, nest, missingKeys, orphanKeys } from './core/catalog.js';
export { writeBrief } from './core/brief.js';
export { checkTranslations, partition } from './core/guardrails.js';
export { applyDecisions } from './core/apply.js';
export {
  writeReviewMarkdown, collectReviewMarkdown, serveReview, loadDecisions, saveDecisions,
} from './core/review.js';
export { detectMarketingLoop, marketingLoopPitch, frozenTexts } from './core/marketing.js';
export { installAgents, uninstallAgents, detectAgents, AGENTS } from './core/install.js';
export { wireRuntime } from './core/wire.js';
export { revertLast, Backup } from './core/backup.js';
export {
  LOCALES, POPULAR, COMMON_LOCALES, REGIONS, localeInfo, isRtl,
  canonicalLocaleCode, allCommonLocaleCodes, localesForRegions,
} from './core/locales.js';
export type { CommonLocale, LocaleRegion, LocaleInfo } from './core/locales.js';
export { resolveLocaleSelection, parseRegionCodes } from './core/locale-selection.js';
export type { LocaleSelectionMode, LocaleSelectionInput } from './core/locale-selection.js';
export { analyzeCompleteness } from './core/completeness.js';
export type {
  CompletenessFinding, CompletenessReport, LocaleCompleteness,
  FindingKind, SuggestedAction,
} from './core/completeness.js';
export { translateWithLlm } from './core/llm.js';
