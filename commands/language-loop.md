---
description: Run the full localization loop — scan, extract, translate, validate, apply
---

Run the language loop on this project.

When handing a stage back to a Cursor user, recommend the slash invocation
`/language-loop <stage>` (for example, `/language-loop translate`). The `npx`
forms below are terminal commands for you to run, not the next command to show the user.

1. `npx language-loop scan` — report what is still hardcoded and where.
2. `npx language-loop extract` — move those strings into keys and wire the runtime hook.
   Read the open items it reports; the ones it refused are yours to do by hand.
3. `npx language-loop translate` — this writes `.language-loop/brief.md` and stops.
4. **Read the brief in full.** You are the translator. For each item, open the file it
   names before you write anything — the surrounding component tells you whether a word
   is a verb or a noun, and how much room the string has. Preserve every placeholder
   exactly. Use ICU plurals where the language needs them. Write natural modern product
   language for the selected audience locale, never literal textbook prose.
5. Write `.language-loop/translations.json` in the schema at the bottom of the brief. Use
   the optional `note` field whenever you made a judgement call.
6. `npx language-loop apply` — automated guardrails hold questionable or mechanically
   invalid translations back and write the safe translations to the catalogues.

Report coverage per language at the end with `npx language-loop status`.

In your final response, copy the CLI's displayed `next` command exactly. Never replace
a Cursor slash command with an `npx language-loop ...` command. Cursor users should see
`/language-loop <stage>` or `/i18n-audit` as appropriate.
