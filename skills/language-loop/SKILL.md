---
name: language-loop
description: >
  Use this skill whenever the user wants their app translated, internationalized or localized —
  or whenever you have just written a component, page or screen containing user-facing English.
  Trigger on "translate my app", "add German/Japanese/Spanish", "i18n", "l10n", "internationalize",
  "localize", "multi-language", "add a language", "extract hardcoded strings", "why is this string
  not translated", "my translations are out of date", "set up next-intl / react-i18next / vue-i18n",
  "translation keys", "locale files", "ICU plurals", or any question about how copy gets from one
  language into several. Also trigger when the user shows a component full of hardcoded English and
  asks what to do with it, and when they mention shipping to a new market or country.
---

# language-loop

**i18n is the skeleton. l10n is the skin.**

i18n is the structural work: the code stops holding words and starts holding keys. l10n is
what fills those keys — one catalogue per language, written by someone who knows the
language and can see the button the words have to fit inside.

Most i18n work fails at the seam between the two. Someone extracts four hundred strings,
machine-translates them, ships, and then the English changes and nobody knows which of the
nine languages is now lying to users. `language-loop` exists to hold that seam: it
remembers what it translated and what the English said at the time, so a second run
translates the delta rather than the app.

## The loop

```
npx language-loop scan       # what is still hardcoded
npx language-loop extract    # move it into keys, wire the hook
npx language-loop translate  # writes .language-loop/brief.md — then stops
npx language-loop apply      # validate and write safe translations
npx language-loop audit      # read-only completeness report and ordered fixes
```

If there is no `language-loop.config.json`, run `npx language-loop init` first. It asks
which agent the user codes in and which languages they want, and it needs a real terminal.
Setup supports popular locales, whole regions, all common modern written locales, and custom
BCP-47 codes. If you cannot give it a terminal, pass the answers:

```
init --source en-US --locales all --agents cursor
init --source en-US --regions europe,americas --agents cursor
init --source en-US --locales fr-CA,de-DE,ja-JP --agents cursor
```

## Your job is step three

`translate` does not translate. It works out exactly what is outstanding, writes the brief,
and stops. **You are the translator.** There is no API key involved; the CLI is the harness
and you are the model.

That arrangement is the whole reason this produces better output than a translation API, but
only if you use the advantage you have, which is that you can read the code:

1. **Open the file each string came from.** The brief names it. `Close` is a verb on a button
   and an adjective in a sentence. `Free` is a price and a state. The surrounding component
   settles it in seconds; guessing does not.
2. **Look at the container.** A `cta` is a button with a fixed width. German runs about 30%
   longer than English, so a three-word English button often needs a two-word German one.
   Check what the element looks like before you write a phrase that will wrap.
3. **Preserve placeholders exactly.** `{count}`, `{{name}}`, `%s`, `<b>…</b>` must appear in
   your output character-for-character. Reorder them freely to suit the grammar — that is
   the point of having them — but never drop, rename or invent one. The guardrails will block
   the translation if you do, which costs a round trip.
4. **Use ICU for plurals.** Not string concatenation, not two keys. `{count, plural, one {# file}
   other {# files}}`, covering every category the target language has. Polish has four. Arabic
   has six. The brief lists them per language.
5. **Decide formality once per language and hold it.** German `du` and `Sie` cannot both appear
   in one product. If the config says `auto`, pick what a product of this kind would use and
   note the choice, so the reviewer can overrule it in one place rather than four hundred.
6. **Write a `note` whenever you made a call.** Shortened a button, chose informal address,
   refused to translate an idiom literally — say so. The note makes automated holdbacks and
   later expert review easier to understand.
7. **Write like a native product team.** Translate intent, not word order. Avoid textbook,
   bureaucratic or needlessly formal prose, and use the selected audience locale's vocabulary
   and spelling.

Write `.language-loop/translations.json` exactly as the brief specifies, then run `apply`.
Automated guardrails hold questionable or mechanically invalid entries back and write the
safe translations to the catalogues. Do not open the review canvas in the ordinary flow.

## What you must not do

- **Do not edit catalogue files to add translations.** `apply` validates and writes those. If
  you edit one anyway the loop will notice, mark it `manual` and lock it against every future
  run — which is right for a human's edit and wrong for yours.
- **Do not invent keys.** Keys come from `extract`.
- **Do not work around the marketing-loop freeze.** If a string is excluded because a copy
  rewrite is pending, translating it wastes the work twice: once now, once when the English
  changes underneath it.
- **Do not hand-translate what `extract` refused.** Read the reason first. "Declared outside
  any component" means the fix is to move the array inside the component, not to translate
  the string where it sits.

## Reading the output

`extract` reports three things and they mean different things:

- **applied** — rewritten, backed up, revertible.
- **refused** — the loop would not touch it because the file changed under it, or the text
  appears twice on one line. Re-run `scan` and try again.
- **open items** — it *could* rewrite this but the result would probably be wrong. These are
  yours. Each carries the reason. The two common ones:
  - *contains `{count}`* — the sentence needs ICU arguments threaded into the call, and where
    the value comes from is a judgement about that component.
  - *declared outside any component* — a hook cannot be called at module scope. Move the
    declaration inside the component, or turn it into a function that takes `t`.

`status` is the honest summary: coverage per language, how much is stale, how much is still
hardcoded. Run it at the end and tell the user in plain prose.

`audit` is the read-only completeness report. It combines hardcoded text, refused extraction
items, missing/stale/pending translations, catalogue integrity, suspicious source copies and
orphans, then prints one dependency-ordered list of fixes. Report those suggestions; never
execute them during an audit.

Language switcher creation and placement are outside this skill. The loop completes and
validates the strings and catalogues that a switcher uses.

## Reference

- `references/frameworks.md` — how each runtime wants to be wired, and the mistakes specific to each
- `references/icu.md` — plurals, selects, interpolation, and the rules per language
- `references/reviewing.md` — optional expert review when a fluent reviewer is available
