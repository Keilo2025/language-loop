---
description: Open the translation approval canvas
---

Run `npx language-loop review --ui` and give the user the URL.

By default this shows only the translations carrying a guardrail warning or a note about a
judgement call. Everything else was mechanically clean and is applied as-is. Offer
`review --ui --all` only if they explicitly ask to see the whole batch — and remember they
probably cannot read most of these languages, so a longer list is not a better review.

The canvas is theirs, not yours. Do not approve items on their behalf. If they ask what
they are looking at, explain that their job is not to check the grammar of a language
they may not speak — it is to check the decisions: that buttons still fit, that brand
names survived, that the formality choice matches the product, and that anything the
translator flagged in a note is the call this company wants to make.

After they save, run `npx language-loop apply`.
