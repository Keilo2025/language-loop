# Changelog

All notable changes to Language Loop are documented here.

## Unreleased

## 0.4.2 - 2026-08-02

### Added

- `run --llm` now preflights the configured translator and judge before the
  loop starts: each unmet requirement (missing project, missing credentials)
  is reported with the exact variable or config key that fixes it, and the
  loop exits non-zero without translating or writing anything.
- The CLI now loads the project's own `.env` at startup, so `run --llm` and
  `translate --llm` find `OPENAI_API_KEY`, `GOOGLE_CLOUD_TRANSLATION_API_KEY`,
  `GOOGLE_CLOUD_ACCESS_TOKEN` and `GOOGLE_CLOUD_PROJECT` without shell exports
  or `--env-file` plumbing. Variables already set in the real environment
  always win; the LLM commands print which names were loaded, never values.

## 0.4.1 - 2026-07-30

### Added

- Added the validated Marketing Loop v0.5 schema-1 consumer contract and exact-key handoff.
- Added a pinned cross-loop contract fixture and coordinated release documentation.
- Added the versioned `language-loop/orchestration` facade and JSON CLI mirror for direct use
  by the unified Content Loop application.
- Added exact category, content-group and canonical-key filters with per-language lifecycle
  progress.

### Fixed

- Kept extraction independent of marketing state and paused translation only for unresolved canonical catalogue keys.
- Refused incompatible or legacy pending marketing state instead of matching proposals by raw text.
- Kept selected canonical keys frozen through work discovery, retries, judging and catalogue
  writes, while preserving all-key behavior when selection is omitted.
- Reported completion only after every selected locale is judge-approved or manual; partial
  batches now remain in the running lifecycle.

## 0.4.0 - 2026-07-29

### Added

- Added `--version` and `-v` CLI flags so installations can report their exact package version.

### Fixed

- Kept the installed localization agent in control of every remaining translation batch instead of handing an unfinished loop back to the user.
- Added regression coverage for autonomous judge-loop completion and installed command handoffs.
