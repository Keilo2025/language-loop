#!/usr/bin/env node
/**
 * `npm version` only knows about package.json, so .claude-plugin/plugin.json
 * drifts every release — it sat on 0.2.1 while the package was 0.2.2, which is
 * the kind of mismatch nobody notices until they are debugging the wrong build.
 * Wired into the `version` lifecycle script so it happens on every bump.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, '.claude-plugin', 'plugin.json');

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const plugin = JSON.parse(fs.readFileSync(target, 'utf8'));

if (plugin.version === version) {
  console.log(`plugin.json already at ${version}`);
  process.exit(0);
}

const was = plugin.version;
plugin.version = version;
fs.writeFileSync(target, `${JSON.stringify(plugin, null, 2)}\n`);
console.log(`plugin.json ${was} -> ${version}`);
