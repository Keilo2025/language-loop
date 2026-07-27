# ICU messages

The format every serious i18n runtime speaks. Worth knowing properly, because the failures
are silent: a message that is subtly wrong in Polish renders without complaint.

---

## Interpolation

```
Signed in as {name}
```

The braces are not decoration. `"Signed in as " + name` cannot be translated, because in
Japanese the name comes first and in German the verb goes last. A placeholder is what lets
the translator move it.

Some runtimes use `{{name}}` — i18next does. The loop preserves whichever shape the source
uses. Do not convert between them.

---

## Plurals

```
{count, plural, one {# file} other {# files}}
```

`#` renders the number, formatted for the locale. The categories are not "singular and
plural"; they are CLDR grammatical categories, and languages disagree about how many exist.

| language | categories |
| --- | --- |
| Japanese, Chinese, Korean, Thai, Vietnamese, Indonesian | other |
| English, German, Dutch, Swedish, Danish, Norwegian, Finnish, Turkish, Greek, Hindi, Persian | one, other |
| French, Spanish, Portuguese, Italian | one, many, other |
| Romanian | one, few, other |
| Polish, Russian, Ukrainian, Czech | one, few, many, other |
| Hebrew | one, two, many, other |
| Arabic | zero, one, two, few, many, other |

Polish, for `{count} plików`:

```
{count, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}
```

Two branches would be wrong for 2, 3, 4, 22, 23 — which is most of the numbers a user will
actually see. The guardrails flag a plural message that omits a category the target language
uses.

**Exact matches** come before categories:

```
{count, plural, =0 {No files} one {# file} other {# files}}
```

Use `=0` when zero deserves its own sentence rather than a number. "No files yet" reads
better than "0 files".

---

## Select

```
{gender, select, female {She} male {He} other {They}}
```

`other` is mandatory. Use `select` for grammatical branching, not for business logic — a
message with six branches wants to be six keys.

---

## Nesting

```
{count, plural,
  =0 {No one has joined {team} yet}
  one {# person joined {team}}
  other {# people joined {team}}}
```

Legal, and occasionally the only honest way to write a sentence. Keep it to one level: past
that, nobody can read the message and the translator will get it wrong.

---

## Tags

```
Read the <link>documentation</link> before you start
```

The runtime maps `link` to a component. The tag names are part of the message, so they must
survive translation intact, and the tag must wrap the corresponding words in the target
language — which are usually in a different position in the sentence.

---

## What breaks, and how

| symptom | cause |
| --- | --- |
| `{count}` renders literally | placeholder passed with a different name than the message uses |
| Correct in English, wrong number word in Polish for 22 | plural written with only `one` and `other` |
| Throws at render, not at build | unbalanced `{` — ICU parses lazily |
| Number formatted with the wrong separator | number concatenated into the string instead of passed through `#` or `{n, number}` |
| Translation shows the English | key missing from that catalogue; the runtime fell back |

`npx language-loop doctor` catches the first three across every catalogue you have already
shipped, not just the batch you are about to add.
