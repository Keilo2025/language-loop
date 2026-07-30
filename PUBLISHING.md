# Publishing

## npm

```
npm run build
npm test
npm version patch          # or minor / major
npm publish --access public
```

`prepack` builds and `prepublishOnly` runs the tests, so a broken build cannot reach the
registry by accident.

Keep `version` in `package.json` and `.claude-plugin/plugin.json` in step. They are read by
different installers and a mismatch is confusing rather than fatal.

## Claude Code plugin

The repository is its own marketplace — `.claude-plugin/marketplace.json` points at the root.

```
/plugin marketplace add Keilo2025/language-loop
/plugin install language-loop@language-loop
```

Shipped in the plugin: `commands/`, `agents/`, `skills/`, `.claude-plugin/`. Those directories
are also listed in `files` in `package.json`, so the npm tarball carries them too — someone
who installs the CLI gets the skill without a second install.

`commands/*.md` is generated from `COMMANDS` in `src/core/install.ts`, which is the same source
the CLI writes into Cursor and Windsurf. Regenerate after changing it:

```
node --input-type=module -e "
import {COMMANDS} from './dist/core/install.js';
import fs from 'node:fs';
for (const [name, body] of Object.entries(COMMANDS)) fs.writeFileSync('commands/' + name + '.md', body);
"
```

Otherwise the Claude Code commands drift from the ones every other agent gets.

## Before a release

- `npm test` — full build and test suite, no network.
- `npm run test:contract` — validates the pinned marketing handoff schema-1 fixture.
- `npm run test:orchestration` — validates the versioned facade, exact-key isolation,
  filtered multi-locale completion and the CLI mirror.
- Import `language-loop/orchestration` from the built package and verify
  `CONTENT_LOOP_API_VERSION === 1`. The release must contain both
  `dist/orchestration.js` and `dist/orchestration.d.ts`.
- Sanity check the scanner on the fixture. It needs a config, so make one in a scratch copy:

  ```
  rm -rf /tmp/fx && cp -r tests/fixture /tmp/fx
  node dist/cli.js init --cwd /tmp/fx --locales de
  node dist/cli.js scan --cwd /tmp/fx
  ```
- Run the full loop against a real project once. The fixture cannot tell you whether the hook
  injection works on a file shape you have not seen.
- Check `README.md` still describes what the CLI actually does. The help text and the README
  are written by hand and drift independently.

## Coordinated marketing-loop release

The key-based handshake requires `marketing-loop` 0.5+ and `language-loop` 0.4+. Marketing
Loop is the primary Content Loop application and must import the versioned Language Loop
facade instead of copying its extraction, selection, runner, guardrail, judge or apply logic.
Upgrade both together. Before publishing either package:

1. Run both full test suites and both `npm pack --dry-run` checks.
2. Verify Marketing Loop capability-checks `CONTENT_LOOP_API_VERSION === 1` before it sends
   `selection.resolvedKeys`, and that an omitted selection still exercises the Language Loop
   0.4 all-keys/all-configured-locales behavior.
3. Verify the contract fixtures are byte-identical:

   ```bash
   cmp ../marketing-loop/tests/contracts/marketing-handoff-v1.json \
     tests/contracts/marketing-handoff-v1.json
   ```

4. Run the producer-owned lifecycle gate against this checkout:

   ```bash
   LANGUAGE_LOOP_REPO="$PWD" npm --prefix ../marketing-loop run test:cross-loop
   ```

   A skipped cross-loop test is a failed release gate. The tests must prove marketing apply
   leaves application code and target catalogues byte-identical, Language Loop marks only the
   changed source key stale, filtered execution never sends or writes an out-of-scope key,
   and `complete` means every selected locale is judge-accepted.

5. Publish `language-loop@0.4.1`, then immediately publish `marketing-loop@0.5.0`.
6. Verify registry metadata and clean-install smoke tests for both packages.

Rollback rules: never apply schema-v5 state with marketing-loop 0.4, and never translate
unresolved schema-v4 marketing state with language-loop 0.4. After both compatible versions
are installed, run `marketing-loop propose` to regenerate the handoff before translating.
