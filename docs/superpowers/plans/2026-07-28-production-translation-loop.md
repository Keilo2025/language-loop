# Production Translation Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Language Loop into a bounded, provider-backed translation workflow whose translations, verdicts, retries, evaluation results, and browser checks are reproducible and bound to the exact source batch they describe.

**Architecture:** Preserve the current staged CLI while introducing a batch manifest as the integrity boundary, a callback-driven run orchestrator, explicit translator/judge provider contracts, and independently testable evaluation and visual-validation modules. Provider implementations use the platform `fetch` API so the package keeps its zero-runtime-dependency design; Playwright remains optional and is loaded only by `visual-check`.

**Tech Stack:** Node.js 18.17+, TypeScript 5.7, Node's built-in test runner, raw `fetch`, optional Playwright.

## Global Constraints

- Preserve all pre-existing user edits in `src/core/config.ts`, `src/core/extract.ts`, `src/core/scan.ts`, `src/types.ts`, and `tests/regressions.test.js`.
- Implement the six requested areas in their stated order.
- Use red/green TDD for every behavior change.
- Keep credentials out of files, logs, reports, and thrown errors.
- Never apply an artifact whose batch, source hash, candidate hash, locale set, or key set differs from the current manifest.
- Keep provider HTTP code injectable and test it with deterministic fake `fetch` implementations; live credentials are not required for tests.
- Do not automatically commit implementation files that overlap pre-existing user changes. Record verification checkpoints instead, unless the user explicitly asks for commits.

---

## Task 1: Bind translations and verdicts to an immutable batch

**Files:**

- Create: `src/core/batch.ts`
- Create: `tests/batch.test.js`
- Modify: `src/types.ts`
- Modify: `src/core/brief.ts`
- Modify: `src/core/judge.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Write failing batch-integrity tests**

Test:

- `createBatch()` produces a UUID and stable hashes for every `(key, locale)` unit.
- translation artifacts must name the current `batchId` and contain exactly one candidate for every unit.
- verdict artifacts must bind to `batchId`, `sourceHash`, and `candidateHash`.
- missing, duplicate, extra, stale-source, and stale-candidate records are rejected before any apply operation.

- [x] **Step 2: Run the focused test and confirm the expected failure**

Run: `npm test -- --test-name-pattern="batch integrity"`

Expected: failure because `src/core/batch.ts` and the artifact types do not exist.

- [x] **Step 3: Add the manifest and bound artifact types**

Add:

```ts
interface TranslationBatch {
  version: 1;
  id: string;
  createdAt: string;
  units: BatchUnit[];
}

interface BatchUnit {
  key: string;
  locale: string;
  source: string;
  sourceHash: string;
  contextHash: string;
  attempt: number;
}
```

Translation candidates and verdicts carry `batchId`, `sourceHash`, and `candidateHash`. Candidate hashes include the batch, key, locale, source hash, and candidate text.

- [x] **Step 4: Implement strict read/write/validation helpers**

`src/core/batch.ts` owns manifest creation, hashing, serialization, exact-set validation, and human-readable integrity errors. Validation must complete before callers mutate catalogs or memory.

- [x] **Step 5: Integrate the manifest with staged commands**

`translate` creates `.language-loop/batch.json` and clears translation/verdict artifacts from older batches. `judge` validates translations before guardrails or judging. `apply` validates both artifact layers before mutating catalogs.

- [x] **Step 6: Run focused and regression tests**

Run:

```bash
npm test -- --test-name-pattern="batch integrity|judge|apply"
npm test
```

Expected: all tests pass.

## Task 2: Feed mechanical guardrails back into bounded retries

**Files:**

- Create: `tests/retry-loop.test.js`
- Modify: `src/core/guardrails.ts`
- Modify: `src/core/memory.ts`
- Modify: `src/core/config.ts`
- Modify: `src/types.ts`
- Modify: `src/cli.ts`

- [x] **Step 1: Write failing tests for guardrail feedback and ceilings**

Test:

- placeholder comparison is multiset-aware, so a dropped duplicate placeholder fails.
- every mechanically rejected candidate becomes a persisted rework entry with concrete issue text.
- attempts increment once per failed generated candidate.
- entries reaching `ai.maxAttempts` become `needs-human` and are no longer pending.
- manual/staged runs and orchestrated runs use the same transition function.

- [x] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- --test-name-pattern="retry ceiling|guardrail feedback|duplicate placeholder"`

Expected: the new status/config behavior is missing.

- [x] **Step 3: Add bounded retry configuration and status**

Extend configuration with:

```ts
ai: {
  maxAttempts: 2;
  requestTimeoutMs: 30_000;
  transientRetries: 2;
}
```

Add the terminal `needs-human` status while preserving existing memory files via defaults and tolerant parsing.

- [x] **Step 4: Centralize failure transitions**

Add a single memory helper that records issue codes/messages, increments attempts, chooses `rework` or `needs-human`, and updates timestamps. Use it for mechanical and judge rejections.

- [x] **Step 5: Make guardrails multiset-aware and actionable**

Return stable issue codes and readable details. Compare placeholders with occurrence counts instead of sets.

- [x] **Step 6: Persist guardrail failures before invoking a judge**

Only guardrail-clean candidates reach the LLM judge. Save rejected records even when every candidate is mechanically blocked.

- [x] **Step 7: Run focused and full tests**

Run:

```bash
npm test -- --test-name-pattern="retry ceiling|guardrail feedback|duplicate placeholder"
npm test
```

Expected: all tests pass.

## Task 3: Add a true end-to-end `run --llm` orchestrator

**Files:**

- Create: `src/core/runner.ts`
- Create: `tests/runner.test.js`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Write a failing end-to-end loop test**

Use deterministic translator and judge callbacks. Cover:

- a clean first-pass candidate being applied;
- a guardrail failure being retried and then applied;
- a judge failure reaching `needs-human`;
- no-progress detection;
- dry-run preventing catalog writes;
- summary counts and process exit semantics.

- [x] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- --test-name-pattern="end-to-end LLM run"`

Expected: failure because the orchestrator does not exist.

- [x] **Step 3: Implement the bounded loop**

`runTranslationLoop()` repeatedly:

1. computes pending work;
2. creates a fresh batch;
3. translates;
4. validates candidates;
5. runs mechanical guardrails;
6. records guardrail failures;
7. judges only clean candidates;
8. records judge failures;
9. applies accepted candidates;
10. stops on completion, retry ceiling, no progress, or external failure.

- [x] **Step 4: Wire `language-loop run --llm`**

Retain the existing deterministic `run` behavior when `--llm` is absent. With `--llm`, use the same batch artifacts and transitions as staged commands and return non-zero when entries require human attention or an external provider fails.

- [x] **Step 5: Run focused and full tests**

Run:

```bash
npm test -- --test-name-pattern="end-to-end LLM run"
npm test
```

Expected: all tests pass.

## Task 4: Introduce provider adapters and component context packets

**Files:**

- Create: `src/core/context.ts`
- Create: `src/core/providers.ts`
- Create: `tests/context.test.js`
- Create: `tests/providers.test.js`
- Modify: `src/core/memory.ts`
- Modify: `src/core/config.ts`
- Modify: `src/types.ts`
- Modify: `src/core/brief.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Write failing provider-contract tests**

Test translator and judge interfaces are separate, registry errors list supported IDs, timeouts abort requests, transient failures retry only to the configured limit, and non-transient failures do not retry.

- [x] **Step 2: Write failing context-extraction tests**

Context packets include component name, safe source window, relative path, neighboring translation keys, occurrence metadata, and stable context hash. They must be bounded and must not read outside the repository through `..` segments or symlinks.

- [x] **Step 3: Run focused tests and confirm failure**

Run: `npm test -- --test-name-pattern="provider contract|component context"`

Expected: provider/context modules are missing.

- [x] **Step 4: Define narrow provider interfaces**

```ts
interface TranslationProvider {
  readonly id: string;
  translate(request: TranslationRequest): Promise<TranslationCandidate[]>;
}

interface JudgeProvider {
  readonly id: string;
  judge(request: JudgeRequest): Promise<BoundVerdict[]>;
}
```

Add registry factories and a shared abort/timeout/transient-retry HTTP helper.

- [x] **Step 5: Preserve occurrence context in memory**

Persist optional line and component metadata during scanning/sync without invalidating old memory files.

- [x] **Step 6: Build safe bounded context packets**

Resolve the occurrence path under the project realpath, reject escaping symlinks, read a small line window, cap total characters, redact likely secret assignments, and hash only the normalized packet.

- [x] **Step 7: Feed identical context into translator and judge**

Attach the packet to the batch unit and provider request. Do not expose full files or arbitrary repository content.

- [x] **Step 8: Run focused and full tests**

Run:

```bash
npm test -- --test-name-pattern="provider contract|component context"
npm test
```

Expected: all tests pass.

## Task 5: Implement Google Translation LLM and GPT-5.6 judging

**Files:**

- Create: `src/core/providers/google-tllm.ts`
- Create: `src/core/providers/openai-judge.ts`
- Create: `tests/google-tllm.test.js`
- Create: `tests/openai-judge.test.js`
- Modify: `src/core/providers.ts`
- Modify: `src/core/config.ts`
- Modify: `src/types.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Write failing Google adapter tests**

Using a fake `fetch`, verify:

- API-key and OAuth request shapes;
- project/location/model resource construction;
- batched content mapping preserves `(key, locale)` identity;
- malformed, partial, duplicate, and extra provider responses fail closed;
- authentication values never appear in errors.

- [x] **Step 2: Write failing OpenAI judge tests**

Verify the Responses API request uses `gpt-5.6-terra`, explicit low reasoning effort, strict JSON Schema structured output, `store: false`, and the current source/candidate/context hashes. Reject prose, invalid JSON, unknown records, or incomplete result sets.

- [x] **Step 3: Run focused tests and confirm failure**

Run: `npm test -- --test-name-pattern="Google TLLM|GPT-5.6 judge"`

Expected: provider modules are missing.

- [x] **Step 4: Implement Google Translation LLM**

Support:

- `GOOGLE_CLOUD_TRANSLATION_API_KEY` for Basic v2;
- `GOOGLE_CLOUD_ACCESS_TOKEN` for Advanced v3;
- `GOOGLE_CLOUD_PROJECT`;
- configurable location, defaulting to `global`;
- `general/translation-llm`.

Validate every response against the requested batch units before returning candidates.

- [x] **Step 5: Implement GPT-5.6 independent judging**

Call `POST https://api.openai.com/v1/responses` with:

- `model: "gpt-5.6-terra"`;
- `reasoning: { effort: "low" }`;
- strict structured output;
- deterministic rubric and bounded context;
- no translation-generation instruction;
- fail-closed parsing of response output items.

- [x] **Step 6: Register and configure providers**

Use explicit IDs such as `google-tllm` and `openai-gpt-5.6-terra`. Reject unsupported IDs before processing a batch.

- [x] **Step 7: Run focused and full tests**

Run:

```bash
npm test -- --test-name-pattern="Google TLLM|GPT-5.6 judge"
npm test
```

Expected: all tests pass.

## Task 6: Build a multilingual evaluation corpus and evaluator

**Files:**

- Create: `evals/multilingual.jsonl`
- Create: `src/core/eval.ts`
- Create: `tests/eval.test.js`
- Create: `tests/fixtures/eval-candidates.jsonl`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Write failing corpus/evaluator tests**

Validate every JSONL record and require coverage for:

- German (`de-DE`);
- French (`fr-FR`);
- Japanese (`ja-JP`);
- Brazilian Portuguese (`pt-BR`);
- Saudi Arabic (`ar-SA`);
- placeholders and ICU syntax;
- formal/informal tone;
- UI length pressure;
- critical confirmation/destructive action language;
- adversarial meaning mutation.

Test deterministic scoring, per-locale summaries, placeholder failures, terminology failures, and critical-mutation gating.

- [x] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --test-name-pattern="multilingual evaluation"`

Expected: corpus and evaluator are missing.

- [x] **Step 3: Add the seed corpus**

Use versioned JSONL records with source, locale, reference translations, constraints, tags, and critical mutations. Keep records reviewable and concise.

- [x] **Step 4: Implement deterministic evaluation**

Read candidate JSONL, enforce exact record coverage, compute exact-reference/constraint metrics, emit per-locale and aggregate JSON, and fail if critical mutations pass or required invariants fail.

- [x] **Step 5: Add `language-loop eval`**

Support explicit corpus and candidate paths, JSON output, and non-zero exit on threshold failure.

- [x] **Step 6: Run focused and full tests**

Run:

```bash
npm test -- --test-name-pattern="multilingual evaluation"
npm test
```

Expected: all tests pass.

## Task 7: Add safe pseudolocalization

**Files:**

- Create: `src/core/pseudo.ts`
- Create: `tests/pseudo.test.js`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Write failing pseudolocalization tests**

Test:

- `en-XA` expands and accents visible text;
- `ar-XB` wraps text with RTL isolation and mirrors selected punctuation;
- placeholders, HTML/JSX tags, interpolation, ICU blocks, escapes, and newline structure remain byte-identical;
- generated catalogs contain the same keys as the source catalog.

- [x] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- --test-name-pattern="pseudolocalization"`

Expected: pseudo module is missing.

- [x] **Step 3: Implement protected-token pseudolocalization**

Use a small scanner to split message syntax from visible text. Transform only visible segments and validate syntax tokens after generation.

- [x] **Step 4: Add `language-loop pseudo`**

Generate `en-XA` and `ar-XB` through the existing catalog adapter without modifying translation memory.

- [x] **Step 5: Run focused and full tests**

Run:

```bash
npm test -- --test-name-pattern="pseudolocalization"
npm test
```

Expected: all tests pass.

## Task 8: Add screenshot overflow and RTL browser validation

**Files:**

- Create: `src/core/visual.ts`
- Create: `tests/visual.test.js`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Modify: `package.json`

- [x] **Step 1: Write failing visual-validation tests**

Use an injected browser runtime to cover:

- deterministic locale URL construction;
- desktop and mobile viewports;
- full-page screenshot paths;
- horizontal document overflow;
- element clipping and scroll overflow;
- `dir="rtl"` and computed direction checks for Arabic;
- visible physical left/right CSS warnings;
- browser console/page errors;
- non-zero result when any mandatory check fails.

- [x] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --test-name-pattern="visual localization"`

Expected: visual module is missing.

- [x] **Step 3: Implement the Playwright-optional harness**

Dynamically load `playwright` only when the command runs. Emit an actionable install message if unavailable. Capture screenshots under `.language-loop/visual/<run-id>/` and write a machine-readable report.

- [x] **Step 4: Add `language-loop visual-check`**

Accept a URL or `{locale}` URL template, locales, output path, and strict mode. Check both pseudolocales plus configured RTL locales by default.

- [x] **Step 5: Run focused tests**

Run: `npm test -- --test-name-pattern="visual localization"`

Expected: all visual unit tests pass without requiring a real browser.

- [x] **Step 6: Run a real smoke validation when Playwright is available**

Start the fixture server, execute the browser check, inspect screenshots/report, and stop the server. If Playwright is absent, verify the documented actionable error instead of installing it silently.

- [x] **Step 7: Run the full suite**

Run:

```bash
npm test
npm run build
```

Expected: all tests and compilation pass.

## Task 9: Document and verify the complete workflow

**Files:**

- Modify: `README.md`
- Modify: `.env.example` if present
- Modify: `package.json`

- [x] **Step 1: Document the workflow in the requested order**

Cover configuration, environment variables, staged/manual operation, `run --llm`, failure/ceiling semantics, evaluation, pseudolocales, browser validation, artifact locations, and provider privacy boundaries.

- [x] **Step 2: Verify credential and artifact hygiene**

Run:

```bash
rg -n "sk-|AIza|Bearer [A-Za-z0-9_-]{12,}" . --glob '!node_modules/**' --glob '!.git/**'
git status --short
```

Expected: no credentials; only intended source, test, corpus, and documentation changes.

- [x] **Step 3: Run the complete verification matrix**

Run:

```bash
npm test
npm run build
node dist/cli.js help
node dist/cli.js eval --corpus evals/multilingual.jsonl --candidates tests/fixtures/eval-candidates.jsonl
```

Expected: build/tests/help/evaluation all succeed. Also run one expected-failure evaluation fixture and confirm a non-zero exit.

- [x] **Step 4: Review the diff**

Confirm:

- no pre-existing user edits were discarded;
- every artifact crossing a stage is hash-bound;
- every retry path is bounded;
- translation and judgment use independent provider contracts;
- Arabic and pseudo locales are represented in visual checks;
- no command claims success after a partial provider response.
