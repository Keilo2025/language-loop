# Reviewing translations you cannot read

The reviewer usually speaks one or two of the languages in front of them, and the loop asks
them to approve nine. That sounds absurd until you notice what they are actually being asked
to check.

They are not checking the grammar. They are checking the **decisions** — and every decision
worth catching is visible without speaking the language.

---

## What a non-speaker can genuinely verify

**Does the brand name still appear?** If the product is called DeployWatch and the German
says *Einsatzbeobachter*, that is visible at a glance and it is wrong. Put the product name
in `voice.doNotTranslate` and the guardrails will block it, but eyes are the backstop.

**Did the placeholders survive?** `{count}` in the source, `{count}` in the translation. The
guardrails block a missing one, but a reviewer scanning for braces catches the case where
the count moved into a clause that no longer makes sense.

**Does it fit?** Compare lengths. A four-character English button against a thirty-character
German one will overflow, whatever the German says. The loop flags this for buttons, labels
and nav items — the places where length breaks a layout rather than just filling more of it.

**Is the formality consistent?** You do not need German to see that one string says *du* and
another says *Sie*. Mixed address is the most common complaint about machine-translated
products, and it is caught by pattern matching, not comprehension.

**Do the numbers match?** If the English says "4 minutes" and the translation says something
containing 14, look again. Digits are digits in every script the loop supports except when
the translator deliberately localised the numeral.

**Does the translator's note describe a decision you agree with?** This is the important one.
"Shortened to two words so it fits the button", "chose informal address for a developer
tool", "kept 'deploy' in English because the German industry term is the English word" — those
are product decisions wearing linguistic clothes. Overrule them here, once, rather than in
four hundred strings later.

---

## What a non-speaker cannot verify, and should not pretend to

Whether it reads naturally. Whether the register is right for the market. Whether an idiom
landed. For a product with real users in a language, one native speaker reading the shipped
UI once is worth more than any amount of string-by-string review — and they should be reading
it in the interface, not in a spreadsheet.

Approving without that is a reasonable trade for most products at most stages. It is not a
reasonable trade for legal text, medical instructions, or anything where a wrong word costs
money. Those strings belong in `voice.doNotTranslate` or with a professional.

---

## Working through the canvas

`npx language-loop review --ui` puts every proposal on one page: source on the left, editable
translation on the right, the note and any warnings below.

`j` and `k` move, `a` approves, `r` rejects. Edit any translation directly — what you type is
what gets written, and anything you touch is marked `manual`, which locks it against every
future run of the loop. That last part matters: a fix you make by hand stays fixed.

Rejecting is cheap. A rejected item is offered again on the next run, so "I am not sure" is a
reject, not an approve.

Over SSH or in a PR, `npx language-loop review` writes `review.md` with tick boxes instead,
and `review --collect` reads your ticks back.

---

## A reasonable first pass

1. Sort by kind. Read every `cta`, `label` and `error` — the short, load-bearing strings.
2. Skim the notes. Every note is a decision someone made on your behalf.
3. Check the warnings. Each one is a specific claim about a specific string.
4. Approve the body copy in bulk if the above three came out clean.
5. Ship, then have a native speaker walk the actual product in that language.

Step five is the one that finds the real problems. Steps one to four are what make step five
short.
