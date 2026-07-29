---
description: Run the full localization loop — scan, extract, translate, judge, apply
---

Run the language loop on this project.

A stage argument chooses where the run starts, not where it stops. For example,
`/language-loop translate` starts at translation and still owns every later batch and
locale. The `npx` forms below are terminal commands for you to run.

1. `npx language-loop scan` — report what is still hardcoded and where.
2. `npx language-loop extract` — move those strings into keys and wire the runtime hook.
   Read the open items it reports; the ones it refused are yours to do by hand.
3. `npx language-loop translate` — this writes `.language-loop/brief.md` and stops.
   The brief may contain **rework** items: strings the judge rejected on an earlier pass,
   each carrying the reason. Fix the stated problem rather than rephrasing around it.
4. **Read the brief in full.** You are the translator. For each item, open the file it
   names before you write anything — the surrounding component tells you whether a word
   is a verb or a noun, and how much room the string has. Preserve every placeholder
   exactly. Use ICU plurals where the language needs them. Write natural modern product
   language for the selected audience locale, never literal textbook prose.
5. Write `.language-loop/translations.json` in the schema at the bottom of the brief. Use
   the optional `note` field whenever you made a judgement call.
6. `npx language-loop judge` — writes `.language-loop/judge.md`. Read your own translations
   back against the source and the component, and write `.language-loop/verdicts.json`.
   The AI judge owns this decision because the user probably cannot read these languages.
   Approve correct translations on the user's behalf; reject only incorrect ones and give
   a concrete correction for the next autonomous pass.
7. `npx language-loop apply` — automated guardrails hold questionable or mechanically
   invalid translations back and write the safe translations to the catalogues. Anything
   the judge rejected is sent back rather than written.
8. **If `apply` reports translations sent back, go to step 3 and do another pass.** That is
   the loop closing. Repeat until nothing comes back. Never hand a rejected translation to
   the user for approval; inspect the source component, correct it, and judge it again.
9. **Continue immediately across every batch and locale.** Finish all outstanding strings
   for one language before moving to the next. Do not stop, summarize, or ask the user to
   invoke `/language-loop` again while `translate` still reports work.

## Completion gate

After every `apply`, use its remaining-work count as the loop condition. When work remains,
the CLI's displayed `next` step is your next internal action: execute the shown `npx`
command immediately in this run. Do not turn an intermediate `next` step into a user
handoff.

When `translate` reports nothing left, run `npx language-loop status` and then
`npx language-loop audit`. Only send a successful final response after `audit` reports
complete. If `audit` reports a genuine blocker, finish every other pending locale first,
then report that blocker instead of claiming the translation goal is complete.
