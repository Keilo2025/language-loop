# Language Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add modern audience-locale selection by individual locale, region, or all common locales, then add a separate read-only completeness audit with ordered repair suggestions.

**Architecture:** Keep the locale catalogue and selection logic pure and independent of the interactive CLI. Build completeness as a structured analyzer over existing scan, memory, catalogue, and guardrail primitives; render terminal or Cursor commands only at the presentation boundary.

**Tech Stack:** TypeScript, Node.js 18.17+, Node test runner, Unicode BCP-47/`Intl`

## Global Constraints

- Normal setup and audit must not download CLDR data or require a network connection.
- Offer modern, commonly written audience locales; exclude historical and obscure academic language entries.
- Preserve support for custom valid BCP-47 locale codes.
- `/i18n-audit` and `npx language-loop audit` are strictly read-only.
- `/language-loop` remains the fixing workflow.
- Do not create, style, place, or modify a language switcher.
- Translations must use natural modern product language for the selected audience locale.
- Existing uncommitted Cursor command changes must be preserved.

---

### Task 1: Common Audience-Locale Catalogue

**Files:**
- Create: `src/core/locale-catalog.ts`
- Modify: `src/core/locales.ts`
- Modify: `src/index.ts`
- Create: `tests/locales.test.js`

**Interfaces:**
- Produces:
  - `type LocaleRegion = 'africa' | 'americas' | 'asia' | 'europe' | 'middle-east' | 'oceania'`
  - `interface CommonLocale extends LocaleInfo { nativeName: string; regions: LocaleRegion[]; tier: 'popular' | 'common'; translationGuidance?: string }`
  - `COMMON_LOCALES: CommonLocale[]`
  - `REGIONS: { code: LocaleRegion; label: string }[]`
  - `canonicalLocaleCode(code: string): string`
  - `allCommonLocaleCodes(): string[]`
  - `localesForRegions(regions: LocaleRegion[]): CommonLocale[]`
- Preserves: `LOCALES`, `POPULAR`, `localeInfo`, and `isRtl` exports for compatibility.

- [ ] **Step 1: Write failing catalogue tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMON_LOCALES, allCommonLocaleCodes, canonicalLocaleCode,
  localesForRegions,
} from '../dist/core/locales.js';

test('common locale catalogue uses unique canonical audience locales', () => {
  const codes = COMMON_LOCALES.map((locale) => locale.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(codes.map(canonicalLocaleCode), codes);
  assert.ok(codes.includes('en-US'));
  assert.ok(codes.includes('en-GB'));
  assert.ok(codes.includes('pt-BR'));
  assert.ok(codes.includes('pt-PT'));
  assert.ok(codes.includes('es-419'));
  assert.ok(codes.includes('zh-Hans-CN'));
  assert.ok(codes.includes('zh-Hant-TW'));
});

test('all common locales is stable and does not expose replaced generic codes', () => {
  const codes = allCommonLocaleCodes();
  assert.deepEqual(codes, allCommonLocaleCodes());
  assert.ok(codes.length >= 80);
  assert.ok(!codes.includes('en'));
  assert.ok(!codes.includes('es'));
  assert.ok(!codes.includes('pt'));
});

test('region selection includes multi-region locales once', () => {
  const codes = localesForRegions(['africa', 'middle-east']).map((locale) => locale.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.includes('ar-EG'));
  assert.ok(codes.includes('ar-SA'));
});

test('custom BCP-47 codes are canonicalized and invalid codes are rejected', () => {
  assert.equal(canonicalLocaleCode('EN-us'), 'en-US');
  assert.throws(() => canonicalLocaleCode('not_a_locale'), /Invalid locale code/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run build && node --test tests/locales.test.js`

Expected: FAIL because the catalogue and helpers do not exist.

- [ ] **Step 3: Add the checked-in catalogue**

Create `src/core/locale-catalog.ts` with region metadata and these reviewed initial codes:

```ts
export const COMMON_LOCALE_CODES = [
  // Africa
  'af-ZA', 'am-ET', 'ar-EG', 'ar-MA', 'en-NG', 'en-ZA', 'fr-CD', 'fr-MA',
  'ha-NG', 'ig-NG', 'rw-RW', 'so-SO', 'sw-KE', 'sw-TZ', 'yo-NG', 'zu-ZA',
  // Americas
  'en-US', 'en-CA', 'es-419', 'es-MX', 'es-AR', 'es-CO', 'es-US', 'fr-CA',
  'pt-BR', 'ht-HT', 'qu-PE',
  // Asia
  'bn-BD', 'my-MM', 'zh-Hans-CN', 'zh-Hant-HK', 'zh-Hant-TW', 'hi-IN',
  'id-ID', 'ja-JP', 'jv-ID', 'km-KH', 'ko-KR', 'ms-MY', 'mr-IN', 'ne-NP',
  'pa-Guru-IN', 'si-LK', 'ta-IN', 'te-IN', 'th-TH', 'ur-PK', 'uz-Latn-UZ',
  'vi-VN', 'fil-PH', 'gu-IN', 'kn-IN', 'ml-IN', 'kk-KZ', 'mn-MN',
  // Europe
  'bg-BG', 'ca-ES', 'cs-CZ', 'da-DK', 'de-DE', 'de-AT', 'de-CH', 'el-GR',
  'en-GB', 'es-ES', 'et-EE', 'eu-ES', 'fi-FI', 'fr-FR', 'ga-IE', 'hr-HR',
  'hu-HU', 'is-IS', 'it-IT', 'lt-LT', 'lv-LV', 'mk-MK', 'nb-NO', 'nl-NL',
  'nl-BE', 'pl-PL', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'sl-SI',
  'sr-Cyrl-RS', 'sr-Latn-RS', 'sv-SE', 'uk-UA', 'cy-GB',
  // Middle East
  'ar-001', 'ar-SA', 'ar-AE', 'fa-IR', 'he-IL', 'ckb-IQ', 'tr-TR',
  // Oceania
  'en-AU', 'en-NZ', 'mi-NZ', 'sm-WS',
] as const;
```

Store native labels, multi-region membership, and popularity tier beside each entry. Use
`Intl.PluralRules(code).resolvedOptions().pluralCategories`, `Intl.DisplayNames`, reviewed RTL
language prefixes, and existing expansion/formality overrides to construct complete
`CommonLocale` records. Sort popular entries first, then English display name, then code.

- [ ] **Step 4: Preserve compatibility in `locales.ts`**

Make `LOCALES` alias `COMMON_LOCALES`, derive `POPULAR` from `tier === 'popular'`, and make
`localeInfo` first match an exact canonical locale, then a base-language profile, then its
existing conservative fallback. Export the new APIs from `src/index.ts`.

- [ ] **Step 5: Run the focused tests**

Run: `npm run build && node --test tests/locales.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/locale-catalog.ts src/core/locales.ts src/index.ts tests/locales.test.js
git commit -m "feat: add common audience locale catalogue"
```

---

### Task 2: Setup Selection by Popular, Region, All, or Custom

**Files:**
- Create: `src/core/locale-selection.ts`
- Modify: `src/cli.ts`
- Modify: `src/core/prompt.ts`
- Modify: `src/index.ts`
- Create: `tests/locale-selection.test.js`
- Modify: `tests/regressions.test.js`

**Interfaces:**
- Consumes: catalogue APIs from Task 1.
- Produces:
  - `type LocaleSelectionMode = 'popular' | 'regions' | 'all' | 'custom'`
  - `resolveLocaleSelection(input: { sourceLocale: string; mode: LocaleSelectionMode; regions?: string[]; codes?: string[] }): string[]`
  - `parseRegionCodes(values: string[]): LocaleRegion[]`

- [ ] **Step 1: Write failing pure-selection tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocaleSelection } from '../dist/core/locale-selection.js';

test('all selects every common locale and includes the source once', () => {
  const locales = resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'all' });
  assert.equal(locales[0], 'en-US');
  assert.equal(locales.filter((code) => code === 'en-US').length, 1);
  assert.ok(locales.length >= 80);
});

test('regions combine and deduplicate their locale choices', () => {
  const locales = resolveLocaleSelection({
    sourceLocale: 'en-US',
    mode: 'regions',
    regions: ['europe', 'americas'],
  });
  assert.equal(new Set(locales).size, locales.length);
  assert.ok(locales.includes('en-GB'));
  assert.ok(locales.includes('es-419'));
});

test('custom selection canonicalizes valid codes', () => {
  assert.deepEqual(
    resolveLocaleSelection({ sourceLocale: 'en-US', mode: 'custom', codes: ['FR-ca', 'de-DE'] }),
    ['en-US', 'fr-CA', 'de-DE'],
  );
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/locale-selection.test.js`

Expected: FAIL because `locale-selection.js` does not exist.

- [ ] **Step 3: Implement pure selection**

Implement exact mode behavior:

```ts
export function resolveLocaleSelection(input: LocaleSelectionInput): string[] {
  const source = canonicalLocaleCode(input.sourceLocale);
  const targets =
    input.mode === 'all' ? allCommonLocaleCodes()
    : input.mode === 'regions' ? localesForRegions(parseRegionCodes(input.regions ?? [])).map((l) => l.code)
    : input.mode === 'popular' ? COMMON_LOCALES.filter((l) => l.tier === 'popular').map((l) => l.code)
    : (input.codes ?? []).map(canonicalLocaleCode);
  return [source, ...targets.filter((code) => code !== source)];
}
```

Reject empty region/custom selections and unknown regions with messages listing valid values.

- [ ] **Step 4: Change interactive `init`**

After source locale entry, call `prompt.pick` with:

```ts
[
  { value: 'popular', label: 'Popular languages', hint: 'pick individual audience locales' },
  { value: 'regions', label: 'By region', hint: 'Africa, Americas, Asia, Europe, Middle East, Oceania' },
  { value: 'all', label: 'All common languages', hint: `${COMMON_LOCALES.length} modern written locales` },
  { value: 'custom', label: 'Enter locale codes', hint: 'any valid BCP-47 code' },
]
```

For `regions`, use `prompt.multi` to choose regions, expand them, then show the resulting locales
preselected so pressing Enter keeps the whole region and entering numbers refines it. For `all`,
show the exact count and require `prompt.confirm`. For `popular`, show popular entries. For
`custom`, accept comma-separated codes with `prompt.text`.

- [ ] **Step 5: Change noninteractive `init`**

Interpret:

```text
--locales all
--regions europe,americas
--locales fr-CA,de-DE
```

Reject using `--regions` together with a nonempty `--locales` value. Canonicalize the source and
target codes before saving.

- [ ] **Step 6: Add CLI regression tests**

Spawn:

```js
spawnSync(process.execPath, [
  'dist/cli.js', 'init', '--cwd', dir,
  '--source', 'en-US', '--locales', 'all', '--agents', 'cursor',
])
```

Assert the saved config contains at least 80 unique canonical locales. Add a second test for
`--regions europe,americas` and one invalid-region failure.

- [ ] **Step 7: Run focused and full tests**

Run: `npm run build && node --test tests/locale-selection.test.js tests/regressions.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/locale-selection.ts src/cli.ts src/core/prompt.ts src/index.ts tests/locale-selection.test.js tests/regressions.test.js
git commit -m "feat: select locales by region or all"
```

---

### Task 3: Natural Audience-Locale Translation Guidance

**Files:**
- Modify: `src/core/brief.ts`
- Modify: `src/core/install.ts`
- Modify: `commands/language-loop.md`
- Create: `tests/brief.test.js`

**Interfaces:**
- Consumes: `localeInfo(code)` audience labels from Task 1.
- Produces no new public API.

- [ ] **Step 1: Write a failing brief behavior test**

Create a brief for `en-US` to `pt-BR` and assert it contains:

```js
assert.match(brief, /Portuguese \(Brazil\)/);
assert.match(brief, /native user would expect in a modern app/i);
assert.match(brief, /avoid textbook, bureaucratic, or overly formal/i);
assert.match(brief, /Brazilian vocabulary and spelling/i);
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/brief.test.js`

Expected: FAIL on the natural-language requirements.

- [ ] **Step 3: Update translation guidance**

Add brief rules that require intent-first, everyday product language and the selected locale's
regional spelling/vocabulary. Add `translationGuidance` to catalogue entries for variants that
need an explicit phrase, including `pt-BR`, `pt-PT`, `es-419`, `es-ES`, `fr-CA`, `de-CH`,
`zh-Hans-CN`, and `zh-Hant-TW`.

Mirror the same standard in the generated agent rule and `/language-loop` command.

- [ ] **Step 4: Run tests and commit**

Run: `npm run build && node --test tests/brief.test.js`

Expected: PASS.

```bash
git add src/core/brief.ts src/core/locale-catalog.ts src/core/install.ts commands/language-loop.md tests/brief.test.js
git commit -m "feat: guide natural locale-specific translation"
```

---

### Task 4: Pure Completeness Analyzer

**Files:**
- Create: `src/core/completeness.ts`
- Modify: `src/index.ts`
- Create: `tests/completeness.test.js`

**Interfaces:**
- Produces:

```ts
export type FindingKind =
  | 'hardcoded' | 'refused' | 'missing-source-key' | 'missing-translation'
  | 'stale' | 'pending' | 'approved-unapplied' | 'orphan'
  | 'integrity' | 'source-copy' | 'runtime-locale-gap';

export type SuggestedAction =
  | 'extract' | 'manual-extract' | 'translate' | 'review'
  | 'apply' | 'retranslate' | 'prune' | 'setup';

export interface CompletenessFinding {
  kind: FindingKind;
  severity: 'block' | 'warn';
  message: string;
  files: string[];
  locales: string[];
  keys: string[];
  action: SuggestedAction;
}

export interface CompletenessReport {
  complete: boolean;
  findings: CompletenessFinding[];
  byLocale: Record<string, {
    total: number; approved: number; manual: number; missing: number;
    stale: number; pending: number; blocked: number; coverage: number;
  }>;
  actions: SuggestedAction[];
}

export function analyzeCompleteness(cwd: string, config: Config): CompletenessReport;
```

- [ ] **Step 1: Write table-driven failing tests**

Build real temporary projects for hardcoded text, missing locale values, stale memory entries,
pending translations, placeholder corruption, legitimate brand-name source copies, suspicious
source copies, and orphan keys. Assert exact `kind`, `severity`, `action`, and per-locale totals.

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/completeness.test.js`

Expected: FAIL because the analyzer does not exist.

- [ ] **Step 3: Implement the analyzer using existing primitives**

Use `scanRepo`, `scanKeyUsage`, `loadMemory`, `readCatalog`, `sourceCatalog`, `pendingWork`,
`missingKeys`, `orphanKeys`, and `checkTranslations`. Do not call mutation-oriented adoption,
extraction, review, or apply functions.

Order actions by dependency:

```ts
const ACTION_ORDER: SuggestedAction[] = [
  'extract', 'manual-extract', 'setup', 'translate',
  'retranslate', 'review', 'apply', 'prune',
];
```

Deduplicate actions while preserving this order. Treat a locale as complete only when it has no
missing/stale values and no blocking integrity finding. Exclude exact source copies that are
listed in `voice.doNotTranslate`, glossary locks, placeholders-only values, URLs, codes, or
proper-name tokens.

- [ ] **Step 4: Prove the analyzer is read-only**

Snapshot every file in a fixture before and after `analyzeCompleteness` and assert identical
relative paths and bytes.

- [ ] **Step 5: Run tests and commit**

Run: `npm run build && node --test tests/completeness.test.js`

Expected: PASS.

```bash
git add src/core/completeness.ts src/index.ts tests/completeness.test.js
git commit -m "feat: analyze localization completeness"
```

---

### Task 5: Read-Only Audit CLI with Ordered Fix Suggestions

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/core/report.ts`
- Modify: `src/core/install.ts`
- Modify: `commands/i18n-audit.md`
- Create: `tests/audit.test.js`

**Interfaces:**
- Consumes: `analyzeCompleteness` and `CompletenessReport` from Task 4.
- Produces:
  - CLI command `language-loop audit`
  - `renderCompletenessReport(report: CompletenessReport, config: Config): void`
  - `commandForAction(config: Config, action: SuggestedAction): string`

- [ ] **Step 1: Write failing CLI tests**

Spawn `dist/cli.js audit --cwd <fixture>` and assert:

```js
assert.match(run.stdout, /Language completeness/);
assert.match(run.stdout, /Hardcoded text/);
assert.match(run.stdout, /\/language-loop extract/); // Cursor config
assert.doesNotMatch(run.stdout, /npx language-loop extract/);
```

Add a terminal-config case that expects `npx language-loop extract`, a clean-project case that
prints complete with no next steps, and a before/after byte snapshot proving the CLI is read-only.

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/audit.test.js`

Expected: FAIL because `audit` is unknown.

- [ ] **Step 3: Add the CLI and renderer**

Add `case 'audit': return cmdAudit()` to the CLI. Render:

1. project-wide blockers;
2. per-locale completion;
3. warnings;
4. exact affected files/keys;
5. one ordered `next steps` section.

Map actions to commands:

```ts
const STAGES = {
  extract: 'extract',
  translate: 'translate',
  retranslate: 'translate',
  review: 'review',
  apply: 'apply',
  prune: 'extract --prune',
  setup: 'init',
} as const;
```

For Cursor, render `/language-loop <stage>` except review, which renders `/i18n-review`.
For terminal use `npx language-loop <stage>`. Manual extraction findings print prose with exact
file paths before the next executable action.

- [ ] **Step 4: Update generated `/i18n-audit`**

Replace its three-command sequence with:

```md
Run `npx language-loop audit`. This is read-only. Summarize its findings and ordered next steps;
do not execute any suggested command.
```

Update both `COMMANDS` and the checked-in generated command file.

- [ ] **Step 5: Run tests and commit**

Run: `npm run build && node --test tests/audit.test.js`

Expected: PASS.

```bash
git add src/cli.ts src/core/report.ts src/core/install.ts commands/i18n-audit.md tests/audit.test.js
git commit -m "feat: report language completeness fixes"
```

---

### Task 6: Documentation and End-to-End Verification

**Files:**
- Modify: `README.md`
- Modify: `skills/language-loop/SKILL.md`
- Modify: `src/core/install.ts`
- Modify: `commands/language-loop.md`
- Modify: `commands/i18n-audit.md`

**Interfaces:**
- No new APIs.

- [ ] **Step 1: Document setup modes**

Show interactive choices and noninteractive examples:

```bash
npx language-loop init --source en-US --locales all --agents cursor
npx language-loop init --source en-US --regions europe,americas --agents cursor
npx language-loop init --source en-US --locales fr-CA,de-DE,ja-JP --agents cursor
```

Document that `all` means the checked-in common modern catalogue, not every ISO language.

- [ ] **Step 2: Document the audit contract**

Explain `npx language-loop audit` and `/i18n-audit`, including the read-only guarantee and
suggested-fix behavior. State explicitly that switcher creation/placement is a non-goal.

- [ ] **Step 3: Regenerate command artifacts**

Run the documented `COMMANDS` generation procedure from `PUBLISHING.md`, then verify:

```bash
git diff --exit-code -- commands/language-loop.md commands/i18n-audit.md
```

Expected: no drift between generated sources and checked-in commands.

- [ ] **Step 4: Run complete verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: exit 0.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md skills/language-loop/SKILL.md src/core/install.ts commands/language-loop.md commands/i18n-audit.md
git commit -m "docs: explain locale setup and completeness audit"
```
