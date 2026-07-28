# language-loop

**A localization loop for vibe-coding agents.** It scans your project, moves every hardcoded
word out of the code and into a key, remembers what it already translated — and on the next
run translates only what changed.

Works in Claude Code, Cursor, Codex, Windsurf, Cline, Copilot and everything else that reads
`AGENTS.md`. Also works on its own, from the terminal, with no agent at all.

```
npx language-loop install     # wire it into every agent in this repo
npx language-loop init        # pick your agent and your languages
npx language-loop scan        # find every hardcoded user-facing string
npx language-loop extract     # turn them into keys and wire up the runtime
npx language-loop translate   # brief your agent on what actually needs doing
npx language-loop judge       # your agent grades its own translations
npx language-loop apply       # write what passed; send the rest back round
npx language-loop audit       # read-only completeness report and ordered fixes
```

## It is a loop, not a pipeline

```
scan ─► extract ─► translate ─► judge ─► apply ─┬─► done
                       ▲                        │
                       └──── rejected, with ────┘
                             the reason why
```

`judge` is the stage that makes the rest safe to run unattended. Your agent reads its own
translations back — against the English, and against the component the string lives in —
and returns a verdict on each. Anything it rejects never reaches your catalogues. It goes
back to `translate` carrying the reason it failed, and round it goes again.

The mechanical guardrails run *before* the judge, so tokens are never spent asking for an
opinion on a translation that is already broken. The AI judge is the approval authority:
it approves correct translations on behalf of the vibe coder and returns incorrect ones
with a concrete correction until they pass.

This exists because of a specific problem: **you probably cannot read the languages you are
shipping.** A review screen asking you to approve two hundred Russian strings is not
oversight, it is a rubber stamp. So the loop checks and approves its own work instead of
handing the decision back to you.

```bash
npx language-loop status                  # coverage and autonomous rework
```

**Re-runs are cheap.** Memory records what is already translated and the hash of the English
it was translated from. Add a page, run the loop again, and it translates that page — not
your app. Change an English string and only its translations go stale. That is the whole
reason the memory file belongs in git.

During `init`, pick from the popular audience locales, search the full catalogue by name
(type `swahili`, `swiss`, `brazil`), select whole regions, take every language at once, or
enter custom BCP-47 codes. Noninteractive setup supports the same paths:

```bash
npx language-loop init --source en-US --locales all --agents cursor
npx language-loop init --source en-US --locales everything --agents cursor
npx language-loop init --source en-US --regions europe,americas --agents cursor
npx language-loop init --source en-US --locales fr-CA,de-DE,ja-JP --agents cursor
```

The catalogue covers every language ICU can name — every ISO 639-1 language plus the major
regional varieties, ~385 entries in all. Names, plural categories and text direction are read
out of the ICU data in your Node at runtime, so the list cannot silently go stale.

`all` is the ~200 **audience locales**: the ones with a country attached, like `pt-BR` and
`es-MX`. `everything` adds the long tail of bare languages such as `eo` or `bo`. Regional
tags are the default on purpose — nobody speaks the language academy's version of their
language, and every regional tag carries a dialect instruction into the translation brief
telling your agent to write the everyday register rather than the textbook one.

---

## i18n is the skeleton. l10n is the skin.

**i18n** is structural. The code stops holding words and starts holding keys:

```diff
- <button>Get started free</button>
+ <button>{t('getStartedFree')}</button>
```

**l10n** fills those placeholders with actual languages:

```json
// messages/en.json          // messages/de.json          // messages/ja.json
{ "hero": {                  { "hero": {                  { "hero": {
  "getStartedFree":            "getStartedFree":            "getStartedFree":
    "Get started free" } }       "Kostenlos starten" } }      "無料で始める" } }
```

Two different jobs. The skeleton is mechanical and can be automated almost entirely. The skin
is judgement, and needs someone who can see the button the words have to fit inside.

Most i18n work fails at the seam between them — not at either end.

---

## The problem it fixes

You ask an agent to translate your app. It does. Two weeks later you change one headline, add
a pricing page, and rename a button. Now what?

The honest answer, in most projects, is *nobody knows*. There is no record of which German
string came from which English string, so there is no way to tell which of the nine languages
is now quietly saying last month's thing. The options are re-translate everything, or ship a
product where the English promises one thing and the German promises another.

`language-loop` keeps that record. Every key stores a hash of the English it was translated
from. When the English changes, every translation of it is marked stale — by name, with the
previous version attached so the translator revises rather than starts over.

```
$ npx language-loop status

12 key(s) in the catalogue

  language               coverage        missing  stale  pending  manual
  de German              ███████·····  58%        4      1        0       0
  ja Japanese            █████·······  42%        6      1        0       0

  1 English string(s) have been edited since they were translated.
```

A first run translates the app. A run after adding one page translates one page.

---

## How it works

```
your codebase
     │
     ▼
┌──────────┐
│   scan   │  every user-facing string, classified: heading, cta, error, alt…
└────┬─────┘
     ▼
┌──────────┐
│ extract  │  string → t('key') · hook injected · backup written
└────┬─────┘     refuses what it might break, and says why
     ▼
┌──────────┐        ┌──────────────┐
│  memory  │───────▶│   brief.md   │──▶ your coding agent
│ what has │        │ only what is │    reads the code, writes the language
│ changed  │        │  new or stale│
└────┬─────┘        └──────┬───────┘
     │◀────────────────────┘
     ▼
┌────────────┐
│ guardrails │  questionable or invalid translations are held back automatically
└─────┬──────┘
      ▼
┌────────────┐
│   judge    │  the agent reads its own work back: does it say the right thing?
└─────┬──────┘     rejections go back to the brief with the reason attached
      ▼
┌────────────┐
│   apply    │  catalogues only · never source code · one-command revert
└────────────┘
```

### 1. It reads the code, not a spreadsheet

`scan` finds user-facing strings across JSX, TSX, Vue, Svelte, Astro and HTML — text nodes,
`placeholder`, `alt`, `aria-label`, `title`, and the object literals that config-driven UIs
keep their copy in. Each is classified, because a `cta` and a `body` paragraph need different
instructions given to whoever translates them.

No AST. Vibe-coded repos do not always parse, and a parser that throws on one file gives you
nothing for the other four hundred.

It is deliberately quiet. `flex items-center gap-2`, `#0f172a`, `MAX_RETRIES`, `onSubmit` and
`primary` are not copy, and a scanner that flags them wastes more of your time than one that
misses the occasional real string.

### 2. Extraction refuses more than it does

The rewrite is mechanical, so it applies directly — with a backup and a one-command revert.
But two cases get handed back rather than guessed at:

```
1 left for you or your agent
  components/Hero.tsx:9 "You have {count} builds waiting."
    contains {count} — needs ICU arguments wired into the call by hand

  app/pricing/page.tsx:2 "Solo"
    declared outside any component, where the translation hook is not in scope —
    move the array inside the component, or turn it into a function that takes `t`
```

That second one is the interesting one. `const plans = [{ title: 'Solo' }]` at module scope
is two braces deep and still nowhere a React hook can legally be called. Rewriting it produces
code that compiles and then crashes at import. The loop tracks *function* depth rather than
brace depth specifically so it can tell the difference and decline.

Keys are stable and readable — `hero.getStartedFree`, not `hero.key_47`. Where two strings
want the same name, the suffix is a hash of the source rather than a counter, so a different
scan order can never renumber anyone's keys and orphan their translations.

### 3. Your agent does the language work

`translate` writes `.language-loop/brief.md` and stops. The brief carries the product's
framework and runtime, the voice and formality rules, the glossary, the do-not-translate list,
the plural categories for each target language, the file each string came from — and only the
items that are new or stale.

**This is what makes it work inside a coding agent with no API key.** The CLI is the harness;
your agent is the model. It reads the brief, opens the component behind each string, and
writes `.language-loop/translations.json`.

That arrangement is not a workaround for the lack of a key. It produces better translations
than a translation API does, because the translator can see the button:

> `hero.startMyFreeAudit` · **cta** · `components/Hero.tsx`
> source: `"Start my free audit"`
> — German runs ~30% longer than English. Keep buttons tight.

A machine translation service gets the string. Your agent gets the string, the element, the
component, and the reason the words are there.

Standalone? `--llm` uses `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The same automated
guardrails apply either way.

### 4. Guardrails decide what is safe to write

**Blocked outright:** a placeholder present in the source and missing from the translation, or
invented in the translation and absent from the source. Unbalanced HTML tags. Unbalanced ICU
braces. An ICU plural with no `other` branch. A brand name from `doNotTranslate` that did not
survive. An empty translation. And a translation that begins "Here is the German version:" —
the failure mode where a model answers the brief instead of doing it.

**Held back automatically:** a plural message missing a category the target language actually uses
(Polish has four, Arabic has six — two branches is wrong for most numbers a user will see). A
button three times the English length, which is a layout bug regardless of what it says. A
glossary term rendered differently from the agreed translation. Copy identical to the source.

`doctor` runs the same checks across catalogues you shipped months ago, not just the batch
you are about to add.

### 5. Apply validates and writes the safe translations

```
npx language-loop apply
```

There is no approval screen in the workflow. Guardrail-clean entries go to the AI judge,
which checks meaning, locale, register and fit against the source component. Correct entries
are approved on the vibe coder's behalf; rejected entries stay out and return to the
translator with the reason. Placeholder, ICU, brand-term, glossary, and layout checks remain
hard mechanical gates.

### 6. Apply touches catalogues, never code

Only guardrail-clean translations. The English catalogue is regenerated from memory each time —
it is a projection of the code, not something to hand-edit. Keys the code no longer has are
reported and kept, because a key vanishes when someone comments a component out for an
afternoon; `--prune` removes them when you mean it.

```
npx language-loop apply --dry-run
npx language-loop apply
npx language-loop revert
```

---

## Memory

`.language-loop/memory.json`. **Commit it.** It is what makes the loop cheap to re-run, and it
belongs to the project rather than to whichever laptop happened to run the command.

```json
{
  "hero.startMyFreeAudit": {
    "source": "Start my free audit",
    "sourceHash": "9f2c1a4b8e3d5c07",
    "kind": "cta",
    "file": "components/Hero.tsx",
    "translations": {
      "de": { "value": "Kostenlose Analyse starten", "status": "approved", "sourceHash": "9f2c1a…" },
      "ja": { "value": "無料診断を始める", "status": "manual", "by": "human" }
    }
  }
}
```

Five statuses, and the distinctions matter:

| status | meaning |
| --- | --- |
| `new` | never translated |
| `stale` | the English changed after this was written — re-offered with the previous version attached |
| `pending` | translated but not yet accepted into a catalogue |
| `approved` | accepted by the automated guardrails |
| `manual` | a human wrote or edited it directly — never overwritten, by anything |

Once `extract` has run, the English lives in `messages/en.json`, and that becomes the place
copy actually gets edited — by a writer, by marketing-loop, by anyone who does not want to open
a `.tsx` file. The loop watches that file. Change a headline there and every translation of it
goes stale on the next run, by name.

Memory also notices when a key leaves. A key is only dead once it is neither still hardcoded
nor called anywhere in the code — deleting a page really does retire its strings, while a key
extracted last month is left alone. They are reported and kept by default; `extract --prune`
forgets them, so you stop paying to re-translate copy nothing renders.

---

## Install

### As an npm CLI

```
npx language-loop install     # no install needed, or:
npm i -g language-loop
```

`install` detects the agents already in your repo and writes their config. `--all` writes every
one, `--list` shows the ids.

### Slash commands

Agents with invokable commands get two:

| command | what it does |
| --- | --- |
| `/language-loop` | run the whole loop, agent does the translating |
| `/i18n-audit` | read-only completeness report with ordered fix suggestions |

| agent | command directory |
| --- | --- |
| Cursor | `.cursor/commands/` |
| Windsurf | `.windsurf/workflows/` |
| Cline | `.clinerules/workflows/` |
| Claude Code | via the plugin |

For agents with no command directory — Codex, Copilot, Gemini CLI, Aider and the rest — say
"run the language loop" and the rule file below tells them what to do.

### Rules

Rules are background context, not something you invoke. Every agent gets one.

| agent | file |
| --- | --- |
| Codex, Cursor, Copilot, Gemini CLI, Aider, Amp, OpenCode, Zed, Windsurf | `AGENTS.md` |
| Claude Code | `CLAUDE.md` (or install the plugin — better) |
| Cursor | `.cursor/rules/language-loop.mdc` |
| Windsurf | `.windsurf/rules/language-loop.md` |
| Cline | `.clinerules/language-loop.md` |
| Roo Code | `.roo/rules/language-loop.md` |
| Kilo Code | `.kilocode/rules/language-loop.md` |
| GitHub Copilot | `.github/instructions/language-loop.instructions.md` |
| Gemini CLI | `GEMINI.md` |
| Continue | `.continue/rules/language-loop.md` |
| Junie (JetBrains) | `.junie/guidelines.md` |
| Trae | `.trae/rules/project_rules.md` |
| Zed | `.rules` |
| Aider | `CONVENTIONS.md` |
| OpenCode | `.opencode/language-loop.md` |

Everything is written between `<!-- language-loop:start -->` markers, so re-running updates in
place and `npx language-loop uninstall` removes it cleanly.

### As a Claude Code plugin

```
/plugin marketplace add Keilo2025/language-loop
/plugin install language-loop@language-loop
```

You get:

- **`/language-loop`** — the whole loop, with the agent translating
- **`/i18n-audit`** — a report on what is hardcoded and what has gone stale
- **`language-loop` skill** — triggers automatically whenever you ask about translation, i18n
  or shipping to a new market
- **`localization-engineer` subagent** — a localization engineer who opens the file before
  translating the string

---

## Working with marketing-loop

If [`marketing-loop`](https://github.com/Keilo2025/marketing-loop) is installed, the two hand
off to each other. If it is not, `language-loop` will explain once why you might want it, and
then get out of the way.

**The order is not arbitrary.** `language-loop` translates whatever the English currently says.
If the English is a feature list — *"Advanced analytics dashboard with real-time sync"* — you
are about to pay to have that sentence carefully reproduced in nine languages, and pay again
when someone rewrites it. Worse: until they do, your German users read the old promise and your
English users read the new one.

So, with both installed:

1. **`marketing-loop` fixes the source copy**, from the code rather than the README, with a
   human approving every rewrite.
2. **`language-loop` refuses to translate any string with an open rewrite.** They appear in the
   brief as frozen, with the reason.
3. **Your tone, banned words and audience carry into the translation brief**, so the nine
   languages sound like the one you approved.

```
npx language-loop sync-marketing
```

Prints the handshake state and tells you which side needs attention. Nothing breaks without
marketing-loop — the freeze simply never engages.

---

## Configuration

`language-loop.config.json`:

```json
{
  "sourceLocale": "en-US",
  "locales": ["en-US", "de-DE", "fr-CA", "ja-JP", "ar-001"],
  "runtime": "next-intl",
  "messagesDir": "messages",
  "layout": "single-file",

  "voice": {
    "tone": "plain and direct — say what the thing does, do not sell it",
    "formality": "informal",

    // Never translated. Brand names, product nouns. Enforced by the guardrails.
    "doNotTranslate": ["DeployWatch", "Pipeline Graph"],

    // Terms whose rendering is fixed, per language.
    "glossary": {
      "deploy": { "de": "Deployment", "ja": "デプロイ" }
    }
  },

  "keyStyle": "nested",
  "maxLengthRatio": 2.0,
  "protectedFiles": ["LICENSE", "CHANGELOG.md"],
  "marketingLoop": { "enabled": true, "respectPendingCopy": true },
  "maxBatch": 200
}
```

Locale choices represent real product audiences where written usage differs: `en-US` and
`en-GB`, `pt-BR` and `pt-PT`, `es-419` and `es-ES`, or Simplified and Traditional Chinese.
Custom valid BCP-47 locales remain supported.

`language-loop` analyzes and completes the strings and catalogues behind a language switcher.
It intentionally does not create, style, or place the switcher itself.

**`formality` is the setting people wish they had thought about.** German `du` and `Sie`,
French `tu` and `vous`, Spanish `tú` and `usted` — pick one per product and hold it. Mixed
address is the most common complaint about machine-translated software, and it is invisible
until a native speaker sees it.

---

## Supported runtimes

Detected from `package.json`, and the loop uses what is already installed rather than
introducing a second one.

| runtime | fits |
| --- | --- |
| `next-intl` | Next.js App Router |
| `next-i18next` | Next.js Pages Router |
| `react-i18next` | React, Vite, CRA |
| `vue-i18n` | Vue, Nuxt |
| `svelte-i18n` | Svelte |
| `paraglide` | SvelteKit, compile-time messages |
| `plain` | a generated ~40-line `t()` with no dependency |

If none is installed, `init` offers to write the setup files for the one that fits your
framework. It never overwrites a file that already exists.

---

## Right-to-left

Arabic, Hebrew and Persian need `dir="rtl"` on `<html>`, not just translated words. The loop
tells you which of your locales are RTL and reminds you at `init`; the layout work is yours,
because it is a design decision rather than a string one.

---

## Programmatic use

```js
import {
  scanRepo, assignKeys, planExtraction, applyExtraction,
  loadMemory, syncMemory, pendingWork, writeBrief,
  checkTranslations, applyDecisions, loadConfig, analyzeCompleteness,
  COMMON_LOCALES, localesForRegions,
} from 'language-loop';

const config = loadConfig(process.cwd());
const memory = loadMemory(process.cwd(), config.sourceLocale);
const { strings } = scanRepo(process.cwd(), config);
const keyed = assignKeys(strings, config, memory);
const work = pendingWork(memory, config);
```

Every stage is exported, so the loop drops into CI, a git hook, or an MCP server. Automatic
guardrails and the AI judge are the default and require no translation approval from the user.

---

## FAQ

**Does it need an API key?** No. Inside a coding agent, the agent is the model — it reads
`brief.md`. `--llm` exists for unattended runs.

**Will it edit my code?** `extract` will, which is its job. Every file is backed up first and
`revert` undoes the run. `apply` never touches source code — only catalogues.

**What if I edit a translation by hand?** It wins, permanently. The loop notices on the next
run, marks it `manual`, and never offers to overwrite it.

**I added one page. Does it re-translate everything?** No. That is the point of the memory
file. New keys are new; everything else is untouched unless its English changed.

**It missed strings in my repo.** The scanner is conservative on purpose — false positives cost
more of your time than false negatives. Move copy into a JSON or Markdown content file where it
is unambiguous, or add the file pattern to `include`.

**It refused to extract something.** Read the reason. "Declared outside any component" means a
hook cannot legally be called there and rewriting it would produce an import-time crash. The
fix is structural, and it is in the message.

**A translation is wrong.** Fix it on the canvas, or in the catalogue directly. Either way it
becomes `manual` and stays.

**Why is my ICU plural flagged in Polish but not in German?** German has two plural categories.
Polish has four. A message with only `one` and `other` is wrong for 2, 3, 22 and 23 — which is
most of the numbers a user will actually see.

**Do my strings get uploaded?** Not by default. Everything is local. With `--llm`, the brief —
which contains your source strings — goes to that API.

---

## Development

```
npm install
npm run build
npm test          # 31 tests, no network
node dist/cli.js scan --cwd tests/fixture
```

MIT.
