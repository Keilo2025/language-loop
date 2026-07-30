# Content Loop Language Orchestration Design

## Decision

Marketing Loop is the primary user-facing Content Loop application. It consumes
Language Loop as a package dependency through a stable, versioned
`language-loop/orchestration` module. Language Loop keeps ownership of source
extraction, translation memory, provider/judge retries, guardrails, catalogue
writes, and Marketing handoff validation.

Marketing Loop must not reproduce those internals or invoke private Language
Loop files. Existing Language Loop exports and CLI commands remain compatible.

## Public boundary

The orchestration subpath exposes three stateless operations:

```ts
CONTENT_LOOP_API_VERSION = 1
inspectLanguageLoop(input: InspectLanguageLoopInput): LanguageLoopSnapshot
extractLanguageLoop(input: ExtractLanguageLoopInput): ExtractLanguageLoopResult
runLanguageLoop(input: RunLanguageLoopInput): Promise<RunLanguageLoopResult>
```

Every result has `schemaVersion: 1`. Expected lifecycle states are returned as
data. Invalid filters, corrupt state, incompatible Marketing handoffs, and
unsupported locales use stable machine-readable error codes.

The CLI mirrors the same boundary:

```text
language-loop orchestrate status --json
language-loop orchestrate extract --json
language-loop orchestrate translate --llm --json
```

The CLI calls the public facade; it does not maintain a second implementation.
Marketing Loop imports the module directly. The CLI mirror is for diagnostics,
automation fallback, and contract testing, not a second user-facing workflow.

## Message selection

All operations accept the same optional `MessageFilter`:

```ts
interface MessageFilter {
  categories?: MessageCategory[];
  groups?: string[];
  keys?: string[];
}
```

No filter means all messages. A provided filter is the union of its selectors:

- categories map stable user-facing names to existing Language Loop kinds;
- groups match the exact stored namespace;
- keys match exact canonical catalogue keys.

`cta` and `button` intentionally resolve to the existing `cta` kind because the
scanner classifies button copy as CTA copy. `headline` resolves to `heading` and
`title`; `navigation` resolves to `nav`. The result reports the normalized
filter, exact selected keys, and unmatched explicit keys/groups. Missing
explicit keys or groups block execution instead of silently broadening or
narrowing the user's selection.

The filter resolves to canonical keys before a provider call or write. The
low-level `RunTranslationLoopInput` accepts additive `keys?: string[]`;
omitting it preserves the existing all-key behavior. Supplying it makes those
canonical keys the complete runner scope for pending selection, batches,
retries, Marketing waits, progress, apply decisions, and catalogue writes. Scan,
extraction, Marketing-wait counts, translation batches, progress, completion,
and catalogue writes all use that exact resolved set. The schema-v1 Marketing
handoff fixture remains byte-identical and the base fields are unchanged.

The handoff may add:

```ts
selection?: {
  filter: MessageFilter;
  resolvedKeys: string[];
  targetLocales: string[];
}
```

When present, this selection is authoritative. Language Loop validates that the
filter resolves to exactly `resolvedKeys`, every key exists, and every target
locale is configured. Caller-provided filter, key, or locale scope must match
the handoff selection exactly. A mismatch blocks the run; it never widens or
silently narrows the selection. Selected unresolved keys pause only selected
work, while unresolved out-of-filter keys do not expand the run.

## Lifecycle and progress

`inspectLanguageLoop` returns one of:

- `needs-init`
- `needs-extraction`
- `ready-translation`
- `waiting-marketing`
- `needs-human`
- `complete`
- `blocked`

The snapshot contains the exact next stage, filter resolution, selected locales,
hardcoded/open-item counts, Marketing compatibility and selected unresolved
keys, plus progress for every selected target locale.

Per-language progress reports:

```ts
interface LanguageProgress {
  locale: string;
  total: number;
  accepted: number;
  pending: number;
  marketingBlocked: number;
  needsHuman: number;
  status: 'pending' | 'waiting-marketing' | 'needs-human' | 'complete';
}
```

Accepted means an up-to-date `approved` translation or a protected `manual`
translation. A legacy `pending` value is not accepted and re-enters the
translation/judge loop.

`runLanguageLoop` processes every selected key in every selected configured
target locale. It finishes one locale before moving to the next, continues
across all batches, and retries guardrail/judge rejection until approval or the
configured retry ceiling. It emits an initial progress event and an event after
every batch.

The run may report `complete` only when every selected locale has accepted every
selected key. It may stop incomplete only for:

- a strictly validated selected Marketing key that is still unresolved;
- a selected translation that reached `ai.maxAttempts` and now needs a human;
- an incompatible/corrupt boundary or no-progress invariant failure.

The runner continues all feasible selected work before returning one of those
terminal constraints.

## Extraction safety

`extractLanguageLoop` owns the full existing extraction transaction:

1. load config and memory;
2. adopt existing catalogue/source edits in memory;
3. scan all configured source files;
4. assign deterministic keys against all reserved catalogue keys;
5. resolve the filter to exact keys;
6. plan and freshly revalidate only selected edits;
7. capture source, state, and catalogue files in one backup;
8. synchronize memory only for edits that landed;
9. write source fallbacks and preserve approved/manual target translations;
10. commit the backup, or roll the entire operation back.

Unselected source strings remain untouched. Dry runs do not mutate source,
memory, catalogues, or backup state.

## Compatibility and release

- Marketing handoff schema remains version 1.
- `CONTENT_LOOP_API_VERSION` is exported as the literal `1`; Marketing Loop
  checks this before using selection-aware execution.
- Compatible package floor remains Marketing Loop 0.5 and Language Loop 0.4.
- Existing root exports and commands remain additive and callable.
- The new subpath is exported explicitly from `package.json`.
- Marketing Loop should depend on a compatible Language Loop release and import
  only `language-loop/orchestration` for the unified workflow.
- Cross-loop release gates retain the byte-identical handoff fixture and add a
  filtered, multi-locale completion scenario where feasible.

## Verification

Language Loop tests cover:

- filter normalization and exact-key/group mismatch refusal;
- API capability negotiation and `RunTranslationLoopInput.keys` enforcement;
- optional handoff-selection inheritance and mismatch refusal;
- filtered extraction without out-of-scope writes;
- filtered translation across every selected locale;
- retries until judge acceptance;
- per-language progress events;
- incomplete Marketing and human-decision terminal states;
- lifecycle snapshots and JSON CLI parity;
- existing unfiltered and low-level API behavior;
- package subpath and dry-run packaging.
