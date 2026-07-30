# Content Loop Language Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable Language Loop dependency facade that lets Marketing Loop run filtered extraction and continuous, judge-accepted translation across every selected locale.

**Architecture:** A focused selection module resolves user filters to exact canonical keys. A versioned public orchestration module owns lifecycle inspection, the existing extraction transaction, and the existing bounded translation runner; the CLI imports that same module. The Marketing schema-v1 handoff stays unchanged and is validated before selected work runs.

**Tech Stack:** TypeScript ESM, Node.js 18+, `node:test`, file-backed JSON state.

## Global Constraints

- Marketing Loop is the primary unified app; Language Loop is consumed as a module.
- Keep extraction, Marketing review, translation, judging, and apply as protected stages.
- Never process a key outside the resolved user filter.
- Never report complete until every selected key in every selected configured target locale is approved or protected manual work.
- Preserve Marketing 0.5 schema-v1 validation and all Language Loop v0.4 APIs.
- Do not add runtime dependencies or modify Marketing Loop files.

---

### Task 1: Exact message selection and progress

**Files:**
- Create: `src/core/selection.ts`
- Modify: `src/types.ts`
- Test: `tests/orchestration.test.js`

**Interfaces:**
- Produces: `MessageFilter`, `MessageCategory`, `ResolvedMessageFilter`, `LanguageProgress`, `resolveMessageFilter()`, `resolveTargetLocales()`, and `languageProgress()`.

- [ ] **Step 1: Write filter contract tests**

```js
const resolved = resolveMessageFilter(memory, {
  categories: ['headline'],
  groups: ['checkout'],
  keys: ['nav.home'],
});
assert.deepEqual(resolved.selectedKeys, [
  'checkout.title',
  'hero.title',
  'nav.home',
]);
assert.throws(
  () => resolveMessageFilter(memory, { keys: ['missing.key'] }),
  /FILTER_MISMATCH/,
);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run build && node --test tests/orchestration.test.js`

Expected: FAIL because `src/core/selection.ts` and its exports do not exist.

- [ ] **Step 3: Implement boundary validation and exact resolution**

```ts
export function resolveMessageFilter(
  entries: Readonly<Record<string, Pick<MemoryEntry, 'kind' | 'namespace'>>>,
  filter?: MessageFilter,
): ResolvedMessageFilter {
  // undefined selects all; provided selectors are a union; explicit misses throw.
}
```

Normalize aliases deterministically, sort output keys, reject unsupported
category values, and make groups match `entry.namespace` exactly.

- [ ] **Step 4: Implement selected-locale progress**

```ts
export function languageProgress(
  memory: Memory,
  locales: readonly string[],
  selectedKeys: ReadonlySet<string>,
  marketingKeys: ReadonlySet<string>,
): LanguageProgress[] {
  // approved/manual current-source entries are accepted; every other state is incomplete.
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npm run build && node --test tests/orchestration.test.js`

Expected: PASS for selection and progress cases.

### Task 2: Continuous filtered runner

**Files:**
- Modify: `src/core/runner.ts`
- Modify: `src/core/memory.ts`
- Modify: `src/index.ts`
- Test: `tests/runner.test.js`

**Interfaces:**
- Consumes: `resolveMessageFilter()`, `resolveTargetLocales()`, and `languageProgress()`.
- Produces: additive `filter`, `progress`, and `onProgress` fields on the existing runner input/summary.

- [ ] **Step 1: Write failing multi-locale filtered completion tests**

```js
const summary = await runTranslationLoop({
  cwd,
  memory,
  config,
  keys: ['hero.cta'],
  translator,
  judge,
  onProgress: (event) => events.push(event),
});
assert.equal(summary.status, 'complete');
assert.deepEqual(seen, ['de:hero.cta', 'fr:hero.cta']);
assert(summary.progress.every((locale) => locale.status === 'complete'));
assert.equal(memory.entries['hero.body'].translations.de, undefined);
```

Also reject the first candidate for one locale and assert the runner retries it,
then continues into the next selected locale before returning.

- [ ] **Step 2: Run focused runner tests and verify the new assertions fail**

Run: `npm run build && node --test tests/runner.test.js`

Expected: FAIL because filter/progress fields are not implemented.

- [ ] **Step 3: Filter every pending-work and terminal-state calculation**

Resolve and validate `RunTranslationLoopInput.keys` once at run start. Use only selected keys for batches,
Marketing-blocked counts, needs-human counts, fingerprints, hard limits, and
terminal completion. Validate requested locales against `config.locales`.
Omitted keys preserve the existing all-key behavior; an explicit empty array
selects no keys.

- [ ] **Step 4: Make legacy unjudged values re-enter the loop**

In `pendingWork()`, expose an existing `pending` translation as rework with its
previous value. It cannot count as accepted until the guardrails and judge
approve a fresh candidate.

- [ ] **Step 5: Emit initial and post-batch progress**

```ts
await input.onProgress?.({
  schemaVersion: 1,
  status: 'running',
  batches: summary.batches,
  filter: resolvedFilter,
  progress: currentProgress(),
});
```

Return `complete` only when every returned locale progress row is complete.
Continue eligible work even when another selected key is Marketing-blocked or
needs human ownership.

- [ ] **Step 6: Run runner tests and verify they pass**

Run: `npm run build && node --test tests/runner.test.js`

Expected: PASS, including existing unfiltered behavior.

### Task 3: Versioned public orchestration facade

**Files:**
- Create: `src/orchestration.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Test: `tests/orchestration.test.js`

**Interfaces:**
- Consumes: existing config, scan, key, extraction, memory, catalogue, Marketing handoff, provider, and runner modules.
- Produces: `inspectLanguageLoop()`, `extractLanguageLoop()`, `runLanguageLoop()`, and schema-v1 result types.

- [ ] **Step 1: Write failing lifecycle and filtered extraction tests**

```js
const snapshot = inspectLanguageLoop({
  cwd,
  filter: { categories: ['cta'] },
});
assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.phase, 'needs-extraction');
assert.deepEqual(snapshot.filter.selectedKeys, ['hero.startFree']);

const extracted = extractLanguageLoop({
  cwd,
  filter: { categories: ['cta'] },
});
assert.deepEqual(extracted.filter.selectedKeys, ['hero.startFree']);
assert.match(fs.readFileSync(heroFile, 'utf8'), /t\\('startFree'\\)/);
assert.match(fs.readFileSync(heroFile, 'utf8'), />Unselected body copy</);
```

- [ ] **Step 2: Run orchestration tests and verify they fail**

Run: `npm run build && node --test tests/orchestration.test.js`

Expected: FAIL because the public facade is absent.

- [ ] **Step 3: Implement read-only lifecycle inspection**

Return expected lifecycle states as data. Clone memory before adopting catalogue
changes, validate the complete Marketing handoff, intersect unresolved keys with
the resolved filter, and prefer feasible extraction/translation before terminal
waiting or human states.

Export `CONTENT_LOOP_API_VERSION = 1 as const`. When the handoff carries
`selection`, validate that its filter resolves to its exact `resolvedKeys`, its
target locales are configured, and any caller selection is identical.

- [ ] **Step 4: Move the complete extraction transaction behind the facade**

Reuse the exact scan, deterministic key assignment, fresh apply validation,
backup capture, memory synchronization, fallback catalogue, prune, commit, and
rollback logic currently owned by `cmdExtract`. Return structured results; do
not print from the module.

- [ ] **Step 5: Implement the high-level translation wrapper**

Load/adopt state, call `runTranslationLoop()` with the caller's adapters and
the facade-resolved canonical `keys`, save no-batch state when appropriate, and
return a schema-v1 result.

- [ ] **Step 6: Export the stable subpath**

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./locales": "./dist/core/locales.js",
    "./orchestration": "./dist/orchestration.js"
  }
}
```

- [ ] **Step 7: Run orchestration tests and verify they pass**

Run: `npm run build && node --test tests/orchestration.test.js`

Expected: PASS.

### Task 4: CLI mirror without duplicated execution logic

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/regressions.test.js`
- Test: `tests/orchestration.test.js`

**Interfaces:**
- Consumes: the three public orchestration functions.
- Produces: `language-loop orchestrate status|extract|translate`.

- [ ] **Step 1: Write failing JSON CLI tests**

```js
const result = spawnSync(process.execPath, [
  cli,
  'orchestrate',
  'status',
  '--cwd',
  cwd,
  '--categories',
  'cta,headline',
  '--json',
]);
const output = JSON.parse(result.stdout);
assert.equal(output.schemaVersion, 1);
assert.deepEqual(output.filter.requested.categories, ['cta', 'headline']);
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run: `npm run build && node --test tests/orchestration.test.js tests/regressions.test.js`

Expected: FAIL with unknown command `orchestrate`.

- [ ] **Step 3: Add argument parsing and structured output**

Support `--categories`, `--groups`, `--keys`, `--locales`, `--dry-run`,
`--prune`, and `--llm`. JSON mode writes only JSON to stdout. Expected
incomplete states use exit code 2; malformed input uses a schema-v1 structured
error and exit code 1.

- [ ] **Step 4: Delegate existing extraction and autonomous run commands**

Render the facade's structured extraction/run results for legacy human output.
Do not leave a second extraction transaction or provider-backed runner setup in
`src/cli.ts`.

- [ ] **Step 5: Run CLI tests and verify they pass**

Run: `npm run build && node --test tests/orchestration.test.js tests/regressions.test.js`

Expected: PASS.

### Task 5: Compatibility documentation and release verification

**Files:**
- Modify: `README.md`
- Modify: `PUBLISHING.md`
- Modify: `CHANGELOG.md`
- Modify: `skills/language-loop/SKILL.md`
- Modify: `commands/language-loop.md`
- Modify: `src/core/install.ts`
- Test: `tests/regressions.test.js`

**Interfaces:**
- Documents: Marketing Loop direct module usage and the stable filter/completion contract.

- [ ] **Step 1: Document the recommended dependency import**

```ts
import {
  inspectLanguageLoop,
  extractLanguageLoop,
  runLanguageLoop,
} from 'language-loop/orchestration';
```

State that Marketing Loop 0.5 remains the primary app, schema-v1 is unchanged,
filters resolve to exact keys, and complete means every selected locale is
accepted.

- [ ] **Step 2: Update installed guidance and parity assertions**

Keep the generated command strings and checked-in command files byte-identical.
Describe category/group/key filtering and continuous all-locale completion.

- [ ] **Step 3: Run focused and full verification**

Run:

```text
npm run build
node --test tests/orchestration.test.js tests/runner.test.js tests/regressions.test.js
npm test
npm run test:contract
npm_config_cache=/tmp/language-loop-npm-cache npm pack --dry-run
git diff --check
```

Expected: every command exits 0, the full suite has zero failures, and the
package includes `dist/orchestration.js` and `dist/orchestration.d.ts`.

- [ ] **Step 4: Run the producer-owned cross-loop gate**

Run from Marketing Loop:

```text
LANGUAGE_LOOP_REPO=/Users/christianbuchholz/GitStuff/language-loop npm run test:cross-loop
```

Expected: the catalogue handoff scenario passes without modifying Marketing
Loop source files.
