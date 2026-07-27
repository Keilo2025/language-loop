# Bug scan — language-loop

Found by running the built CLI against a scratch Next.js project, not by reading alone.
**All fixed.** Build clean, 41/41 tests pass (31 existing + 10 new regressions in
`tests/regressions.test.js`). Every reproduction below was re-run against the fix.

---

## Critical

### 1. A corrupt `memory.json` was silently wiped — FIXED

`readJson` swallowed every parse error and returned the fallback; `loadMemory` passed an
empty-entries object as that fallback; the next `saveMemory` wrote it out. Truncating the
file and running `status` took 5 keys to 0. The file is committed to git by design, so
conflict markers in it are a matter of time.

**Fix:** added `readJsonPrecious` in `util.ts` — it distinguishes *absent* (fine, start
empty) from *present but unparseable* (throw). `loadMemory` uses it and also rejects a
file that parses but has no `entries` object. `writeJson` is now atomic (temp file +
`rename`) so an interrupted write cannot truncate anything. Conflict markers get their
own message.

```
/tmp/fixed/.language-loop/memory.json exists but is not valid JSON: Expected property name…
It may have been truncated by an interrupted write.
This file is the record of everything already translated, so nothing will be written until it parses.
Restore it from git (git checkout -- …), or delete it to start over and re-translate everything.
```

The on-disk file is left exactly as it was.

*Files:* `core/util.ts`, `core/memory.ts`

---

### 2. The extractor wrote code that did not compile — FIXED

`applyExtraction` applied the edits, then tried to insert the hook, and wrote the file
even when wiring failed. `const B = () => (<h1>…</h1>)` — one of the two most common
React component shapes — matched neither wiring pattern, so it got `t('…')` with no
import and no hook.

**Fix, two parts:**

- If wiring fails, the whole file is abandoned: its edits move from `applied` to
  `skipped` and nothing is written. Half a rewrite is worse than none.
- Concise arrow components are now handled rather than refused — the implicit return
  becomes an explicit one so there is a body to hold the hook.

```tsx
const B = () => {
  const t = useTranslations('b');
  return (
  <h1>{t('nothingHereYetAddYour')}</h1>
);
};
```

*Files:* `core/extract.ts`

---

### 3. Duplicate import and duplicate `const t` — FIXED

Both dedup checks were exact substring matches, so `import {useTranslations}` did not
match `import { useTranslations }`, and `useTranslations("c")` did not match
`useTranslations('c')`. A file already partly internationalised by hand got a second
import and a second `const t` — a duplicate-identifier error.

**Fix:** replaced both with structural matching — `hasImport` compares *what* is imported
and *from where*, ignoring spacing and quote style; `hasStatement` compares the binding
name, the function and the argument. Regex metacharacters in component names are escaped.

*Files:* `core/extract.ts`

---

## High

### 4. Multi-line JSX text was never extracted — FIXED

`scan.ts` recorded the line of the `>` that opens the text node; `extract.ts` matched
against that single line. For text starting on the next line it never matched, and the
reported reason — "source no longer matches — re-run scan" — sent the user down a dead
end, because re-running scan could never help. Prettier wraps JSX text at 80 columns, so
most real prose in a formatted codebase hit this.

**Fix:** `scan` now reports the line where the words actually start, and
`applyExtraction` falls back to a whole-file match when the recorded line misses,
refusing only when the text is genuinely absent or genuinely ambiguous.

```tsx
<p>
  {t('yourDeployBrokeNobodyTold')}
</p>
```

*Files:* `core/scan.ts`, `core/extract.ts`

---

### 5. `--llm` failures crashed with a raw stack trace — FIXED

`cmdTranslate` was sync and called `void runLlm(...)`, so the rejection escaped
`main().catch` and the written-for-humans message was buried in an unhandled-rejection
dump. Every API error (401, 429, model returned prose) took the same path.

**Fix:** `cmdTranslate` is `async` and returns the promise.

*File:* `cli.ts`

---

### 6. `status` mutated and saved memory — FIXED

A command that promises a read-only report could permanently mark translations `manual` /
`by: "human"` — a status no later run will ever overwrite.

**Fix:** `status` computes the drift and reports it without saving:

```
3 hand-written translation(s) in the catalogues not yet adopted — translate picks them up.
```

*File:* `cli.ts`

---

## Medium

### 7. Keys that left the code were never pruned — FIXED

`syncMemory` returned `disappeared` and the CLI only printed the count. Dead keys stayed
in `sourceCatalog` forever, so `orphanKeys` never saw them and `--prune` could never fire;
`pendingWork` kept paying to re-translate strings that no longer existed. The count was
itself meaningless — every previously extracted key was reported missing on every run,
because `scan` only sees strings that are *still hardcoded*.

**Fix:** added `scanKeyUsage` (finds `t('…')`, `$t()`, `formatMessage({id})`, paraglide
`m.foo()`) and `deadKeys`, which treats a key as dead only when it is neither still
hardcoded nor called anywhere — handling namespace-scoped leaves and paraglide's mangled
identifiers. `extract --prune` drops them; without the flag it reports and keeps.

```
- 1 key(s) the code no longer calls — dropped
```

Verified: deleting a page dropped exactly that page's key and left the rest.

*Files:* `core/scan.ts`, `core/memory.ts`, `cli.ts`

---

### 8. `maxBatch` truncated the brief but nothing else — FIXED

The user was told 4,000 items needed translating, got a brief covering 200, and the model
was asked for a token budget sized for 4,000.

**Fix:** the batch is decided once in `cmdTranslate` and threaded through the count, the
brief and the LLM call, with the remainder stated plainly:

```
1 item(s) need translating
  + .language-loop/brief.md  (1 item(s))
  1 more held back — maxBatch is 1. Run translate again after this batch lands.
```

*Files:* `cli.ts`, `core/brief.ts`

---

### 9. `review --collect` bypassed the guardrails — FIXED

The canvas re-checked what the reviewer typed; markdown went straight through to `apply`.

**Fix:** the same `checkTranslations` runs over collected decisions, and approvals that
block are held back rather than saved:

```
0 approved, 0 rejected
1 approved edit(s) held back — they break something mechanically:
  common.yourDeployBrokeNobodyTold · de — translation has {count}, source does not
Fix the `to:` line in review.md and run --collect again.
```

*File:* `cli.ts`

---

### 10. `nest()` silently dropped a value on key-prefix collision — FIXED

`a.b` and `a.b.c` in the same catalogue: whichever was written first was overwritten by
`node[part] = {}`.

**Fix:** both directions now throw, naming the two offending keys and pointing at
`"keyStyle": "flat"` as the way out.

*File:* `core/catalog.ts`

---

### 11. Non-interactive `init` silently reset existing config — FIXED

`init --locales de,fr` in CI reset `sourceLocale` to `en` and unwired every agent.

**Fix:** a field is only overwritten when its flag was actually passed; the source locale
is also added to `locales` as the interactive path already did.

```
sourceLocale: de | agents: ["claude","cursor"] | locales: ["de","fr","es"]
```

*File:* `cli.ts`

---

## Smaller items — all fixed

- `guardrails.ts` — the `icu-malformed` rule required `!value.includes('{')`, making its
  own wrapping test unreachable; rewritten to check that the plural/select is actually
  brace-wrapped. A single `=0{…}` no longer suppresses *all* `plural-category-missing`
  flags — an exact match now only exempts the category it stands in for.
- `util.ts` — `walk` checks `limit` per file, not just per directory, so a single large
  directory cannot overrun it.
- `llm.ts` — `json.choices[0].message.content` is guarded; an empty response now reports
  what came back instead of throwing on `undefined`.
- `cli.ts` — removed the loop-invariant `locale !== sourceLocale` from inside `doctor`'s
  `.filter`.

---

## Not changed, deliberately

- **`revert` does not roll back `memory.json`.** Called out in the code and in the
  command's own output. Rolling it back properly means versioning it alongside the
  backup — worth doing, but a design change rather than a bug fix.
- **Strings with ICU placeholders never enter memory.** `extract` only records what
  landed in the code, and placeholder strings become open items. Correct as it stands:
  translating a key the code does not yet call would be premature.
- **The review server's keep-alive sockets.** I could not reproduce a hang; Node's
  default `keepAliveTimeout` clears it. Left alone.

---

## Regression tests added

`tests/regressions.test.js` — 10 tests, one per failure rather than one per function:
multi-line JSX text, arrow-component wiring, whole-file abandonment when wiring fails,
quote/spacing-insensitive dedup, corrupt and conflicted memory files, atomic writes,
dead-key detection and pruning, and nested-key collisions.
