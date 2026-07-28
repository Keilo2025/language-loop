# Production Translation Loop Design

## Purpose

Turn language-loop's current agent-assisted translation workflow into a resumable,
provider-backed production workflow without removing its existing interactive agent mode.
The resulting system must bind every translation and verdict to the exact source text that
was evaluated, return mechanical failures as actionable rework, stop autonomous retries at
a configured ceiling, and support repeatable linguistic and browser-based quality checks.

The implementation follows this dependency order:

1. Batch and verdict integrity plus guardrail feedback.
2. Retry ceilings and an end-to-end `run --llm` command.
3. Provider adapters and component-context extraction.
4. Google Translation LLM generation and GPT-5.6 judging.
5. A multilingual evaluation corpus and evaluator.
6. Pseudolocalization, screenshot overflow checks, and RTL browser validation.

## Compatibility and boundaries

- Node.js remains `>=18.17`.
- The package keeps zero runtime dependencies.
- Existing `translate`, `judge`, and `apply` commands remain available for coding agents.
- Existing configuration files continue to load through default merging.
- Existing memory version 1 files remain readable. New optional fields do not require a
  destructive migration.
- No real network request is required by the test suite.
- API keys remain environment-only and are never written to config, memory, reports, or logs.
- The current uncommitted scanner/extractor hardening is preserved.

## 1. Batch and verdict integrity

### Batch manifest

Each call to `translate` creates `.language-loop/batch.json` before handing work to an agent
or provider. The manifest is the authority for the active batch and contains:

- `version: 1`
- a random UUID `id`
- `createdAt`
- `sourceLocale`
- `targetLocale`
- `promptVersion`
- one entry per unit with `key`, `locale`, `sourceHash`, `contextHash`, and `attempt`

`translations.json` contains the same `batchId`. Every translation contains `sourceHash`.
The value itself is bound by a deterministic `candidateHash` derived from batch ID, key,
locale, source hash, and translated value.

`verdicts.json` contains `batchId`. Every verdict contains `sourceHash` and `candidateHash`.
`judge` and `apply` reject:

- artifacts for a different batch;
- keys or locales not present in the manifest;
- source hashes that no longer match memory;
- verdicts for a different translation value;
- missing, duplicate, or extra units.

Beginning a new batch clears the prior translation, judge, and verdict artifacts before
writing the new manifest. Approved translation provenance records the actual provider and
model rather than always storing `agent`.

### Guardrail feedback

Mechanical blocks and flags are decisions, not judge input. Both are converted directly to
`rework` records with the exact guardrail messages and attempted value. Only units with no
guardrail issues reach the semantic judge.

This removes the current state where a flagged unit can be shown to the judge, approved,
dropped by `apply`, and then retried as a brand-new item without a reason.

Placeholder validation compares multisets rather than sets so repeated placeholders cannot
silently disappear.

## 2. Retry ceilings and end-to-end execution

Configuration gains:

```json
{
  "ai": {
    "maxAttempts": 2,
    "requestTimeoutMs": 60000,
    "maxRetries": 2
  }
}
```

An item in `rework` is offered again while `attempts < maxAttempts`. At the ceiling it moves
to `needs-human`, remains out of catalogues, appears as blocked in `status` and `audit`, and
is not selected by autonomous runs. A source-text change resets the counter and revives the
item as stale work.

`language-loop run --llm` owns the state machine:

1. synchronize source and manual catalogue edits;
2. generate the next one-locale batch;
3. call the configured translation provider;
4. apply mechanical guardrails and record their rework;
5. call the configured independent judge for clean units;
6. apply approved units and record semantic rejections;
7. continue until work is complete, the retry ceiling is reached, or a configured cost/work
   boundary is hit.

`translate --llm` remains a single-batch compatibility command. `run --llm` is the true
unattended command.

Provider calls use bounded exponential retry for transient HTTP failures and an
`AbortController` timeout. Authentication, validation, and permanent 4xx failures fail
immediately with provider-specific messages.

## 3. Provider adapters and component context

### Provider interfaces

Translation and judging have separate contracts so the same provider is not accidentally
used as both authority and reviewer:

```ts
interface TranslationProvider {
  readonly id: string;
  readonly model: string;
  translate(request: TranslationProviderRequest): Promise<ProviderTranslations>;
}

interface JudgeProvider {
  readonly id: string;
  readonly model: string;
  judge(request: JudgeProviderRequest): Promise<ProviderVerdicts>;
}
```

The provider registry supports explicit configuration and dependency injection in tests.
Provider selection never depends on which unrelated API key happens to exist first.

Existing Anthropic and OpenAI translation support moves behind adapters. Provider output is
validated against the batch manifest before it is written.

### Context packets

Each work unit receives a deterministic context packet built locally:

- source and target locales;
- source string, key, kind, namespace, and component name when known;
- a bounded, line-numbered source excerpt around the originating line;
- adjacent scanned UI strings from the same component/file;
- placeholders and ICU requirements;
- locale dialect and formality guidance;
- relevant glossary entries and do-not-translate terms;
- previous translation and rejection reason for stale/rework units;
- a suggested expansion limit for tight UI kinds.

Context extraction reads only the configured, extractable source file, rejects symlinks that
leave the project, and caps excerpt size. Full files, environment files, credentials, and
unrelated source are never sent.

The context hash participates in the batch manifest. Changing the component context after a
batch was generated invalidates the batch before apply.

## 4. Google TLLM and GPT-5.6 judging

Configuration defaults for unattended mode are:

```json
{
  "ai": {
    "translator": {
      "provider": "google-tllm",
      "model": "general/translation-llm"
    },
    "judge": {
      "provider": "openai",
      "model": "gpt-5.6-terra",
      "reasoningEffort": "low"
    },
    "escalationModel": "gpt-5.6-sol"
  }
}
```

Google authentication supports:

- `GOOGLE_CLOUD_TRANSLATION_API_KEY` for the Basic v2 Translation LLM endpoint; and
- `GOOGLE_CLOUD_ACCESS_TOKEN` plus `GOOGLE_CLOUD_PROJECT` and optional
  `GOOGLE_CLOUD_LOCATION` for the v3 endpoint.

The adapter sends one target locale at a time, preserves item ordering, and includes bounded
context. Glossary IDs may be configured per locale. The adapter maps Google results back to
manifest units and refuses partial responses.

The OpenAI judge uses `POST /v1/responses`, `gpt-5.6-terra`, low reasoning effort, and strict
JSON Schema output. Its rubric emits:

- `ok`;
- `severity`: `none`, `minor`, `major`, or `critical`;
- `category`: `accuracy`, `omission`, `addition`, `terminology`, `locale`, `register`,
  `grammar`, `layout`, or `other`;
- a concrete correction when rejected;
- confidence from 0 to 1.

Low-confidence, major, or critical cases may be re-judged once with `gpt-5.6-sol`. The
escalation verdict is still bound to the same candidate hash.

## 5. Multilingual evaluation

The repository gains a versioned JSONL corpus with representative UI strings for:

- German (`de-DE`);
- French (`fr-FR`);
- Japanese (`ja-JP`);
- Brazilian Portuguese (`pt-BR`);
- Arabic (`ar-SA`).

Each record includes source, locale, kind, context, constraints, one acceptable reference
translation, required terminology, and named critical-error mutations. The initial corpus is
small and high-signal: buttons, navigation, validation errors, billing/security copy,
placeholders, plurals, formality, and RTL-sensitive strings.

`language-loop eval` reads a candidate JSONL file or an installed provider result and reports:

- exact placeholder and protected-token failures;
- glossary adherence;
- acceptable-reference match where specified;
- critical mutation detection;
- per-locale and per-kind pass rates;
- semantic-judge agreement when a judge is explicitly requested.

The deterministic corpus test runs offline. Provider benchmarking is opt-in and never part of
`npm test`.

## 6. Pseudolocalization and browser validation

### Pseudolocalization

`language-loop pseudo` generates two non-shipping catalogues:

- `en-XA`: accented, expanded LTR text that preserves placeholders, ICU syntax, tags, and
  protected terms;
- `ar-XB`: mirrored RTL text wrapped in safe Unicode directional isolation while preserving
  protected tokens.

Generation is deterministic and never modifies memory approval state.

### Browser validation

`language-loop visual-check` writes a browser test harness and a machine-readable report. The
command accepts:

- `--url`;
- `--locales`;
- `--viewport WIDTHxHEIGHT`;
- `--out`;
- `--fail-on-overflow`.

The harness uses Playwright when it is already available in the target project. If it is not
installed, the command explains how to install it and exits without modifying dependencies.
For each locale it:

- navigates to the explicitly supplied URL;
- captures a screenshot;
- records horizontal document overflow;
- records elements whose scroll width/height exceeds their client box;
- verifies `document.documentElement.dir === "rtl"` for RTL locales;
- records console errors.

The report contains no cookies, storage values, authorization headers, or response bodies.
URLs discovered inside page content are never followed.

## Error handling and observability

- Provider errors include provider, model, HTTP status, and retryability without exposing
  response headers or credentials.
- Batch reports record provider/model, durations, counts, and attempts but no API keys.
- Dry-run commands never mutate catalogues or memory.
- `status` distinguishes `rework` from `needs-human`.
- `audit` recommends the exact next command and never triggers provider calls.

## Testing strategy

Every behavior is developed test-first:

1. Unit tests for hashes, manifests, artifact validation, guardrail-to-rework mapping, retry
   ceilings, provider response parsing, context boundaries, pseudolocalization, and corpus
   scoring.
2. CLI integration tests for stale verdict rejection, end-to-end injected-provider runs,
   exhausted retries, evaluation reports, and visual-check harness generation.
3. Provider contract tests use injected `fetch` implementations and recorded response
   shapes—never network.
4. Browser validation is verified against a local fixture page with Playwright when available;
   otherwise the generated harness and missing-dependency behavior are tested.
5. Final verification runs build, all Node tests, fixture CLI smoke tests, and a real isolated
   browser check when the local Playwright runtime is available.

## Success criteria

- No translation can be applied with a verdict for another batch, source, context, or value.
- Every rejected or mechanically held translation returns with an actionable reason.
- Autonomous execution terminates deterministically.
- `run --llm` completes translation, judging, apply, and subsequent batches without an agent.
- Google and OpenAI provider contracts are selectable explicitly and testable offline.
- Direct API providers receive useful bounded component context.
- The repository contains a repeatable multilingual quality baseline.
- Pseudolocales preserve runtime syntax.
- Browser reports detect overflow and missing RTL direction without exposing browser secrets.
