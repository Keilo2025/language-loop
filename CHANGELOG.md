# Changelog

All notable changes to Language Loop are documented here.

## 0.4.0 - 2026-07-29

### Added

- Added `--version` and `-v` CLI flags so installations can report their exact package version.

### Fixed

- Kept the installed localization agent in control of every remaining translation batch instead of handing an unfinished loop back to the user.
- Added regression coverage for autonomous judge-loop completion and installed command handoffs.
