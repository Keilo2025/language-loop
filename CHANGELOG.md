# Changelog

All notable changes to Language Loop are documented here.

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
