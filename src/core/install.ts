import fs from 'node:fs';
import path from 'node:path';
import { exists } from './util.js';

/**
 * Wire the loop into whichever agent is already in this repo.
 *
 * Rules are passive context — the agent reads them and knows the loop exists.
 * Commands are invokable. Most agents get both; the ones without a command
 * directory get the rule, and "run the language loop" is enough for them.
 */

export const START = '<!-- language-loop:start -->';
export const END = '<!-- language-loop:end -->';

export interface AgentTarget {
  id: string;
  label: string;
  rule: string;
  /** Directory for invokable commands, when the agent has one. */
  commandDir?: string;
  commandExt?: string;
  /** Files or directories that prove this agent is already in use here. */
  markers: string[];
}

export const AGENTS: AgentTarget[] = [
  { id: 'claude', label: 'Claude Code', rule: 'CLAUDE.md', markers: ['CLAUDE.md', '.claude'] },
  { id: 'codex', label: 'Codex', rule: 'AGENTS.md', markers: ['AGENTS.md', '.codex'] },
  { id: 'cursor', label: 'Cursor', rule: '.cursor/rules/language-loop.mdc', commandDir: '.cursor/commands', commandExt: '.md', markers: ['.cursor'] },
  { id: 'windsurf', label: 'Windsurf', rule: '.windsurf/rules/language-loop.md', commandDir: '.windsurf/workflows', commandExt: '.md', markers: ['.windsurf'] },
  { id: 'cline', label: 'Cline', rule: '.clinerules/language-loop.md', commandDir: '.clinerules/workflows', commandExt: '.md', markers: ['.clinerules'] },
  { id: 'copilot', label: 'GitHub Copilot', rule: '.github/instructions/language-loop.instructions.md', markers: ['.github/copilot-instructions.md', '.github/instructions'] },
  { id: 'gemini', label: 'Gemini CLI', rule: 'GEMINI.md', markers: ['GEMINI.md', '.gemini'] },
  { id: 'roo', label: 'Roo Code', rule: '.roo/rules/language-loop.md', markers: ['.roo'] },
  { id: 'kilo', label: 'Kilo Code', rule: '.kilocode/rules/language-loop.md', markers: ['.kilocode'] },
  { id: 'continue', label: 'Continue', rule: '.continue/rules/language-loop.md', markers: ['.continue'] },
  { id: 'junie', label: 'Junie (JetBrains)', rule: '.junie/guidelines.md', markers: ['.junie'] },
  { id: 'trae', label: 'Trae', rule: '.trae/rules/project_rules.md', markers: ['.trae'] },
  { id: 'zed', label: 'Zed', rule: '.rules', markers: ['.zed', '.rules'] },
  { id: 'aider', label: 'Aider', rule: 'CONVENTIONS.md', markers: ['.aider.conf.yml', 'CONVENTIONS.md'] },
  { id: 'opencode', label: 'OpenCode', rule: '.opencode/language-loop.md', markers: ['.opencode'] },
  { id: 'amp', label: 'Amp', rule: 'AGENTS.md', markers: ['.amp'] },
];

export function detectAgents(cwd: string): AgentTarget[] {
  return AGENTS.filter((agent) => agent.markers.some((m) => exists(path.join(cwd, m))));
}

export function agentById(id: string): AgentTarget | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function installAgents(cwd: string, ids: string[]): { written: string[]; commands: string[] } {
  const written: string[] = [];
  const commands: string[] = [];
  const seenRules = new Set<string>();

  for (const id of ids) {
    const agent = agentById(id);
    if (!agent) continue;

    if (!seenRules.has(agent.rule)) {
      seenRules.add(agent.rule);
      writeBlock(path.join(cwd, agent.rule), ruleBody());
      written.push(agent.rule);
    }

    if (agent.commandDir) {
      for (const [name, body] of Object.entries(COMMANDS)) {
        const file = path.join(cwd, agent.commandDir, `${name}${agent.commandExt ?? '.md'}`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body, 'utf8');
        commands.push(path.relative(cwd, file));
      }
    }
  }
  return { written, commands };
}

export function uninstallAgents(cwd: string): string[] {
  const removed: string[] = [];
  for (const agent of AGENTS) {
    const file = path.join(cwd, agent.rule);
    if (exists(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const stripped = stripBlock(content);
      if (stripped !== content) {
        if (stripped.trim()) fs.writeFileSync(file, stripped, 'utf8');
        else fs.rmSync(file);
        removed.push(agent.rule);
      }
    }
    if (agent.commandDir) {
      for (const name of Object.keys(COMMANDS)) {
        const cmd = path.join(cwd, agent.commandDir, `${name}${agent.commandExt ?? '.md'}`);
        if (exists(cmd)) {
          fs.rmSync(cmd);
          removed.push(path.relative(cwd, cmd));
        }
      }
    }
  }
  return removed;
}

function writeBlock(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const block = `${START}\n${body}\n${END}`;
  if (!exists(file)) {
    fs.writeFileSync(file, block + '\n', 'utf8');
    return;
  }
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(START) && content.includes(END)) {
    const next = content.replace(new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`), block);
    fs.writeFileSync(file, next, 'utf8');
    return;
  }
  fs.writeFileSync(file, content.trimEnd() + '\n\n' + block + '\n', 'utf8');
}

function stripBlock(content: string): string {
  return content.replace(new RegExp(`\\n*${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}\\n*`), '\n').trimStart();
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ruleBody(): string {
  return `## language-loop

This project uses \`language-loop\` to keep its interface translated. Two halves:
i18n is the skeleton — the code holds keys, not words. l10n is the skin — the
catalogues in the messages directory hold the words, one file per language.

**When the user asks for translation, i18n, localization, or new languages — or when you
have just added a page or component with user-facing English in it — run the loop.**

\`\`\`
npx language-loop scan       # what is still hardcoded
npx language-loop extract    # move those strings into keys, wire up the hook
npx language-loop translate  # writes .language-loop/brief.md for you
npx language-loop judge      # writes .language-loop/judge.md — you grade your own work
npx language-loop apply      # writes what passed; sends the rest back round
\`\`\`

It is a loop, not a line. Anything the judge rejects returns to \`translate\` with the
reason attached, and goes round again until it passes or runs out of attempts. Re-running
after adding a page translates that page only — memory tracks what is already done, so the
loop is cheap the second time.

### Your part

\`translate\` writes \`.language-loop/brief.md\` and stops. **You are the translator.**
Read the brief in full, then write \`.language-loop/translations.json\` in the schema it
gives you. There is no API key involved; the CLI is the harness and you are the model.

Two things make your translations better than a machine translation service, and both
require effort:

1. **Open the file each string came from.** The brief names it. "Close" is a verb on a
   button and an adjective in a sentence, and only the file tells you which.
2. **Respect placeholders exactly.** \`{count}\`, \`{{name}}\`, \`%s\` and HTML tags must survive
   character-for-character. Reorder them to suit the grammar; never drop or rename one.
   The guardrails will block the translation if you do, but that costs a round trip.
3. **Write like a native product team.** Translate intent, not word order. Avoid textbook,
   bureaucratic or needlessly formal phrasing, and use the selected audience locale's
   vocabulary and spelling.

### Rules

- Never edit catalogue files by hand to add translations — \`apply\` validates and writes
  those. If you edit one anyway, the loop will notice and mark it \`manual\`, which locks it
  against future runs.
- **The ordinary flow ends at \`apply\`. Do not open the review canvas.** The user very
  likely does not speak the languages you just wrote, so handing them two hundred strings
  to approve asks for a rubber stamp and calls it oversight. The guardrails are the check:
  they hold back anything mechanically broken, and \`apply\` writes only what passed.
  Report what got held back and why — that is the part a human can act on.
- Only run \`review\` if the user asks for it, and prefer \`review --ui --flagged\`, which
  shows just the items with a guardrail warning or a note you left about a judgement call.
- Never invent a key. Keys come from \`extract\`.
- Do not translate a string \`marketing-loop\` has an open rewrite for. The loop already
  excludes these; do not work around it.
- Re-running is normal and cheap. The memory file tracks what changed, so a second run
  after adding one page translates one page, not the whole app.
`;
}

export const COMMANDS: Record<string, string> = {
  'language-loop': `---
description: Run the full localization loop — scan, extract, translate, judge, apply
---

Run the language loop on this project.

When handing a stage back to a Cursor user, recommend the slash invocation
\`/language-loop <stage>\` (for example, \`/language-loop translate\`). The \`npx\`
forms below are terminal commands for you to run, not the next command to show the user.

1. \`npx language-loop scan\` — report what is still hardcoded and where.
2. \`npx language-loop extract\` — move those strings into keys and wire the runtime hook.
   Read the open items it reports; the ones it refused are yours to do by hand.
3. \`npx language-loop translate\` — this writes \`.language-loop/brief.md\` and stops.
   The brief may contain **rework** items: strings the judge rejected on an earlier pass,
   each carrying the reason. Fix the stated problem rather than rephrasing around it.
4. **Read the brief in full.** You are the translator. For each item, open the file it
   names before you write anything — the surrounding component tells you whether a word
   is a verb or a noun, and how much room the string has. Preserve every placeholder
   exactly. Use ICU plurals where the language needs them. Write natural modern product
   language for the selected audience locale, never literal textbook prose.
5. Write \`.language-loop/translations.json\` in the schema at the bottom of the brief. Use
   the optional \`note\` field whenever you made a judgement call.
6. \`npx language-loop judge\` — writes \`.language-loop/judge.md\`. Read your own translations
   back against the source and the component, and write \`.language-loop/verdicts.json\`.
   Rejecting your own work here is the point of the stage: the user probably cannot read
   these languages, so your verdict is the only quality check there is.
7. \`npx language-loop apply\` — automated guardrails hold questionable or mechanically
   invalid translations back and write the safe translations to the catalogues. Anything
   the judge rejected is sent back rather than written.
8. **If \`apply\` reports translations sent back, go to step 3 and do another pass.** That is
   the loop closing. Repeat until nothing comes back. A string that fails twice stops being
   re-offered and waits for a person — report those instead of trying to force them through.

Report coverage per language at the end with \`npx language-loop status\`.

In your final response, copy the CLI's displayed \`next\` command exactly. Never replace
a Cursor slash command with an \`npx language-loop ...\` command. Cursor users should see
\`/language-loop <stage>\` or \`/i18n-audit\` as appropriate.
`,
  'i18n-audit': `---
description: Report what is hardcoded and how complete each language is — no changes
---

Audit this project's localization without changing anything.

Run \`npx language-loop audit\`. This command is read-only. Summarize its findings and
ordered next steps for the user, but do not execute any suggested command and make no edits.
`,
  'i18n-review': `---
description: Open the translation approval canvas
---

Run \`npx language-loop review --ui --flagged\` and give the user the URL.

\`--flagged\` is deliberate: it shows only the translations carrying a guardrail warning or
a note about a judgement call. Everything else was mechanically clean and is applied as-is.
Offer the unfiltered \`review --ui\` only if they ask to see the whole batch.

The canvas is theirs, not yours. Do not approve items on their behalf. If they ask what
they are looking at, explain that their job is not to check the grammar of a language
they may not speak — it is to check the decisions: that buttons still fit, that brand
names survived, that the formality choice matches the product, and that anything the
translator flagged in a note is the call this company wants to make.

After they save, run \`npx language-loop apply\`.
`,
};
