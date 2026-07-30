---
description: Report what is hardcoded and how complete each language is — no changes
---

Audit this project's localization without changing anything.

Run `npx language-loop audit`. This command is read-only. Summarize its findings and
ordered next steps for the user, but do not execute any suggested command and make no edits.

The ordered lifecycle is scan → extract → optional `marketing-loop propose` →
`marketing-loop review --ui` → `marketing-loop apply` → translate → judge → apply.
language-loop owns extraction and target catalogues; marketing-loop edits only the source
catalogue. Report exact unresolved catalogue keys as waiting on marketing, never matching
strings. If marketing-loop is absent, report the standalone language-loop next step.
