/**
 * Programmatic access to every stage of the loop.
 *
 * The stages are exported separately on purpose: the loop drops into CI, a git
 * hook or an MCP server one piece at a time. Automated guardrails and the AI
 * judge keep broken or questionable translations out.
 */

export type {
  Config, Detection, Memory, MemoryEntry, MemoryTranslation, ScannedString, KeyedString,
  TranslationUnit, GuardrailIssue, WorkItem, StringKind, Runtime, Framework, CatalogLayout,
  TranslationBatch, BatchUnit, TranslationArtifact, TranslationCandidate,
  VerdictArtifact, BoundVerdict, Verdict,
  ComponentContext,
} from './types.js';

export { detect, callExpression, hookFor } from './core/detect.js';
export { loadConfig, saveConfig, defaultConfig, requireConfig, CONFIG_FILE, STATE_DIR } from './core/config.js';
export { scanRepo, isCopy, findPlaceholders, findPlaceholderOccurrences } from './core/scan.js';
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
export {
  BATCH_FILE, TRANSLATIONS_FILE, VERDICTS_FILE, unitId, candidateHash,
  createBatch, writeBatch, readBatch, validateBatchAgainstMemory, clearBatchArtifacts,
  bindTranslationArtifact, bindTranslationSubmission, validateTranslationArtifact,
  bindVerdictArtifact, validateVerdictArtifact,
} from './core/batch.js';
export { runTranslationLoop } from './core/runner.js';
export type {
  RunnerTranslator, RunnerJudge, RunTranslationLoopInput, RunTranslationLoopSummary,
} from './core/runner.js';
export { extractComponentContext, contextMap } from './core/context.js';
export type { ContextOptions } from './core/context.js';
export { ProviderRegistry, requestJson } from './core/providers.js';
export type {
  TranslationProvider, JudgeProvider, TranslationProviderRequest, JudgeProviderRequest,
  FetchLike, JsonRequestOptions,
} from './core/providers.js';
export { GoogleTllmProvider } from './core/providers/google-tllm.js';
export type { GoogleTllmOptions } from './core/providers/google-tllm.js';
export { OpenAiJudgeProvider } from './core/providers/openai-judge.js';
export type { OpenAiJudgeOptions } from './core/providers/openai-judge.js';
export { loadEvalCorpus, loadEvalCandidates, evaluateCorpus } from './core/eval.js';
export type {
  EvalConstraints, EvalRecord, EvalCandidate, EvalFinding, EvalLocaleSummary, EvalReport,
} from './core/eval.js';
export { pseudolocalize, pseudoCatalog, protectedMessageTokens } from './core/pseudo.js';
export type { PseudoLocale } from './core/pseudo.js';
export {
  DEFAULT_VISUAL_VIEWPORTS, buildLocaleUrl, runVisualChecks, createPlaywrightVisualDriver,
} from './core/visual.js';
export type {
  VisualViewport, VisualOverflow, VisualInspection, VisualInspectionInput, VisualDriver,
  VisualCheckOptions, VisualFinding, VisualCheck, VisualReport,
} from './core/visual.js';
