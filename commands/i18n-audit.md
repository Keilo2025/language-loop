---
description: Report what is hardcoded and how complete each language is — no changes
---

Audit this project's localization without changing anything.

```
npx language-loop scan
npx language-loop status
npx language-loop doctor
```

Then summarise for the user, in plain prose:

- How many user-facing strings are still hardcoded, and which files hold the most.
- Coverage per language, and which languages have gone stale because the English changed.
- Anything `doctor` flagged — lost placeholders, malformed ICU, keys in a catalogue that
  no longer exist in the code.
- What it would take to close the gap, in the order you would do it.

Make no edits. This is a report.
