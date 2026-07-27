# Language Completeness Design

## Goal

Make `language-loop` a complete analysis and repair workflow for localized
projects:

- setup offers a practical catalogue of modern, commonly written locales;
- users can select locales individually, by region, or all at once;
- translations are written as natural product language for the selected
  audience, not as literal or academic prose;
- `/i18n-audit` reports language completeness without changing the project;
- every audit finding includes an ordered, concrete next step.

The language switcher itself is outside this project's scope. Other commands or
tools may create and place one. `language-loop` is responsible for ensuring the
text and catalogues behind it are complete.

## Locale Catalogue

### Source and scope

The project will ship a versioned, checked-in locale catalogue derived from
Unicode CLDR. Setup never downloads locale data.

The catalogue represents modern locales that products commonly localize for.
It excludes historical languages, primarily academic classifications, and
obscure variants with no meaningful modern written product audience.

A locale is eligible when it has modern CLDR support and at least one of these
conditions holds:

- it has at least one million regular readers or writers in CLDR population
  data;
- it is an official, de facto official, or broadly used regional language with
  at least 100,000 regular readers or writers, or at least one third of the
  relevant region's population regularly reads or writes it;
- it is a regional or script variant whose spelling, vocabulary, script, or
  product conventions differ enough to require separate translated copy.

The checked-in catalogue is reviewed rather than accepted blindly from a data
generator. This permits practical exclusions and clear audience-facing labels.
Custom BCP-47 locale codes remain supported even when they are not in the
catalogue.

### Human locale variants

Setup presents the locale a reader recognizes, for example:

- English (United States) and English (United Kingdom);
- Portuguese (Brazil) and Portuguese (Portugal);
- Spanish (Spain), Spanish (Mexico), and Spanish (Latin America);
- French (France) and French (Canada);
- Chinese (Simplified) and Chinese (Traditional);
- Serbian (Cyrillic) and Serbian (Latin).

Generic language codes remain only when they are a natural written standard and
a regional qualifier would not change the translation. Canonical BCP-47 codes
are stored in configuration.

Each catalogue entry contains:

- canonical code;
- English and native display names;
- one or more regions;
- writing direction;
- CLDR plural categories;
- formality guidance;
- approximate UI expansion;
- popularity tier.

Languages may belong to more than one region. Selecting multiple regions
deduplicates their locales.

### Regions

The setup regions are:

- Africa
- Americas
- Asia
- Europe
- Middle East
- Oceania

The Middle East is a user-facing discovery group rather than a mutually
exclusive continent. Relevant locales may also occur under Africa or Asia.

## Setup Experience

Interactive `init` asks for the source locale as an audience-facing locale, then
offers four target-selection modes:

1. Popular locales
2. By region
3. All common modern locales
4. Enter locale codes

The region path supports selecting multiple regions and then refining the
resulting locale list. The all path shows the number of target locales and
requires confirmation because it can create a large translation backlog.

Noninteractive setup supports:

- `--locales all`
- `--regions europe,americas`
- the existing comma-separated `--locales` codes

The source locale is included exactly once. Selection order is stable so config
files and generated reports do not churn between runs.

## Natural Translation

The translation brief describes every target as an audience locale, not merely
a language code. It tells the translator to:

- write what a native user would expect in a modern app;
- translate intent rather than word order;
- avoid textbook, bureaucratic, or overly formal language unless the product
  voice requires it;
- use the vocabulary and spelling of the selected regional or script variant;
- preserve placeholders, markup, brand terms, and ICU requirements;
- inspect the source component whenever context changes the meaning.

Existing voice, formality, glossary, and do-not-translate settings remain the
authority. Human review remains required before translations are applied.

## Completeness Audit

### Read-only contract

`/i18n-audit` and its underlying `npx language-loop audit` command never write configuration,
memory, catalogues, source code, decisions, or translation state. The audit may
read all of those sources to calculate the report.

The fixing workflow remains separate under `/language-loop`.

### Findings

The audit calculates:

- hardcoded user-facing strings, grouped by file and kind;
- refused strings that require a manual extraction strategy;
- translation keys called by code but absent from the source catalogue;
- source keys absent from one or more selected locale catalogues;
- missing, stale, pending, approved, manual, and orphaned entries;
- placeholder, markup, ICU plural, and RTL metadata failures;
- suspicious values identical to the source text, excluding brand terms,
  names, codes, and other legitimate matches;
- completion percentage for every selected locale;
- selected locales that are not wired into the detected runtime configuration,
  when that can be determined safely.

The report distinguishes blocking incompleteness from quality warnings. A
locale is complete only when it has no missing or stale keys and no blocking
integrity failures. Pending work is reported separately because it has not
passed the automated guardrails and reached a catalogue yet.

### Suggested next steps

Every finding maps to a corrective action:

| Finding | Suggested action |
| --- | --- |
| Hardcoded text | Extract it |
| Refused string | Show the exact file and recommended manual pattern |
| Missing or stale translation | Translate it |
| Pending translation | Open human review |
| Approved decision not applied | Apply it |
| Placeholder, markup, or plural failure | Retranslate the named key and locale |
| Orphaned key | Prune after confirming the source key was removed |
| Locale configuration gap | Rerun setup with the named locale or region |

The report ends with one deduplicated, dependency-ordered recovery plan.
Suggestions use Cursor slash commands when Cursor is configured and terminal
commands elsewhere. The audit never executes a suggested action.

When no problems exist, the report says the project is complete and does not
print speculative work.

## Architecture

### Locale data

`src/core/locales.ts` remains the public locale API but consumes a separate
checked-in catalogue module. Pure selection helpers provide:

- locale lookup and canonicalization;
- popular locale selection;
- region expansion;
- all-common selection;
- stable deduplication.

Unknown valid BCP-47 codes retain a conservative fallback profile.

### Analysis model

A new pure completeness analyzer combines existing scan, key-usage, memory,
catalogue, and guardrail results into a structured report. Presentation is a
separate layer so CLI text and future JSON output cannot disagree about the
underlying counts.

The report model includes findings, severity, affected files/locales/keys,
completion totals, and suggested action identifiers. Command rendering happens
only at the presentation boundary, which keeps Cursor and terminal syntax out
of the analysis logic.

### Command integration

The existing `scan`, `status`, and `doctor` commands remain available.
`npx language-loop audit` composes their analysis through shared functions
rather than spawning three CLI processes or scraping their printed text.

The generated `/i18n-audit` agent command runs `npx language-loop audit`,
summarizes the structured findings, and preserves the read-only guarantee.
`/language-loop` continues to perform extraction, translation, review, and
application.

## Error Handling

- Invalid custom locale codes are rejected during setup with the exact bad
  token.
- Unknown region names list the accepted region identifiers.
- Empty region selections do not overwrite an existing configuration.
- `all` requires explicit confirmation interactively and explicit spelling
  noninteractively.
- Corrupt memory and catalogue files remain hard errors; they are never treated
  as empty.
- An audit that cannot inspect one subsystem reports that limitation and
  continues with independent checks where safe.

## Testing

Tests cover:

- catalogue codes are unique, canonical, and have complete metadata;
- region and all selection are stable and deduplicated;
- meaningful locale variants are offered instead of inappropriate generic
  codes;
- custom BCP-47 locales still work;
- interactive selection parsing and noninteractive flags;
- audit classification for every finding type;
- read-only audits leave a project byte-for-byte unchanged;
- locale completion rules and suspicious source-copy exclusions;
- recovery actions are deduplicated and dependency ordered;
- Cursor output uses slash commands while terminal output uses `npx`;
- natural-language requirements appear in translation briefs with the selected
  audience locale;
- the complete existing test suite remains green.

## Non-goals

- Creating, styling, or placing a language switcher
- Automatically approving translations
- Claiming linguistic quality can be proven mechanically
- Shipping every ISO 639 code or historical language
- Downloading CLDR data during normal setup or audit
