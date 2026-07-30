---
description: Run the full localization loop — scan, extract, translate, judge, apply
---

Run the language loop on this project.

A stage argument chooses where the run starts, not where it stops. For example,
`/language-loop translate` starts at translation and still owns every later batch and
locale. The `npx` forms below are terminal commands for you to run.

If the user selected only CTA/button, headline, navigation or label messages, exact content
groups, canonical keys or target locales, preserve that scope exactly. Use
`npx language-loop orchestrate status|extract|translate` with `--categories`, `--groups`,
`--keys` and `--locales` for the schema-1 Content Loop mirror. Never substitute an
unfiltered run. `orchestrate translate` requires `--llm`; an embedded Marketing Loop host
passes its translator and judge to `language-loop/orchestration` directly.

1. `npx language-loop scan` — report what is still hardcoded and where.
2. `npx language-loop extract` — move those strings into keys and wire the runtime hook.
   Read the open items it reports; the ones it refused are yours to do by hand.
3. **Optional source-copy pass:** if marketing-loop is installed, run `npx marketing-loop propose`,
   `npx marketing-loop review --ui`, then `npx marketing-loop apply`. marketing-loop edits only
   the source catalogue; language-loop owns extraction and every target catalogue. Exact
   unresolved catalogue keys pause translation; identical text under different keys does not.
4. `npx language-loop translate` — this writes `.language-loop/brief.md` and stops.
   The brief may contain **rework** items: strings the judge rejected on an earlier pass,
   each carrying the reason. Fix the stated problem rather than rephrasing around it.
5. **Read the brief in full.** You are the translator. For each item, open the file it
   names before you write anything — the surrounding component tells you whether a word
   is a verb or a noun, and how much room the string has. Preserve every placeholder
   exactly. Use ICU plurals where the language needs them. Write natural modern product
   language for the selected audience locale, never literal textbook prose.
6. Write `.language-loop/translations.json` in the schema at the bottom of the brief. Use
   the optional `note` field whenever you made a judgement call.
7. `npx language-loop judge` — writes `.language-loop/judge.md`. Read your own translations
   back against the source and the component, and write `.language-loop/verdicts.json`.
   The AI judge owns this decision because the user probably cannot read these languages.
   Approve correct translations on the user's behalf; reject only incorrect ones and give
   a concrete correction for the next autonomous pass.
8. `npx language-loop apply` — automated guardrails hold questionable or mechanically
   invalid translations back and write the safe translations to the catalogues. Anything
   the judge rejected is sent back rather than written.
9. **If `apply` reports translations sent back, go to step 4 and do another pass.** That is
   the loop closing. Repeat until nothing comes back. Never hand a rejected translation to
   the user for approval; inspect the source component, correct it, and judge it again.
10. **Continue immediately across every selected batch and locale.** Finish all selected
   strings for one language before moving to the next. Do not stop, summarize, or ask the
   user to invoke `/language-loop` again while selected translation work remains.

## Completion gate

After every `apply`, use its remaining-work count as the loop condition. When work remains,
the CLI's displayed `next` step is your next internal action: execute the shown `npx`
command immediately in this run. Do not turn an intermediate `next` step into a user
handoff.

When `translate` reports nothing left, run `npx language-loop status` and then
`npx language-loop audit`. Only send a successful final response after `audit` reports
complete and every selected locale is judge-approved or manual. If `audit` reports a
genuine blocker, finish every other selected locale first, then report that blocker instead
of claiming the translation goal is complete.
