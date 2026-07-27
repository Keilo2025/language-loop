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

- `npm test` — 41 tests, no network.
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
