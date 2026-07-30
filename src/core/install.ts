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
      const legacyReview = path.join(cwd, agent.commandDir, `i18n-review${agent.commandExt ?? '.md'}`);
      if (exists(legacyReview)) fs.rmSync(legacyReview);
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
npx marketing-loop propose   # optional: propose source-catalogue copy changes
npx marketing-loop review --ui
npx marketing-loop apply
npx language-loop translate  # writes .language-loop/brief.md for you
npx language-loop judge      # writes .language-loop/judge.md — you grade your own work
npx language-loop apply      # writes what passed; sends the rest back round
\`\`\`

The marketing stages are optional: when marketing-loop is absent, language-loop remains a
standalone localization loop. language-loop owns code extraction and every target catalogue.
When present, marketing-loop 0.5+ is the primary Content Loop application and calls the
versioned language-loop orchestration module directly. It edits only the source catalogue
after \`extract\`; it never extracts text from code or edits target catalogues. When marketing
has unresolved work, only those exact catalogue keys pause—identical text under other keys
keeps moving.

If the user selects message categories, content groups, canonical keys or target locales,
preserve that selection exactly through extraction, retries, judging and apply. Use
\`language-loop orchestrate status|extract|translate\` for the stable Content Loop CLI mirror.
Never widen a filtered run, and report complete only when every selected locale is
judge-approved or manual.

It is a loop, not a line. Anything the AI judge rejects returns to \`translate\` with the
reason attached, and goes round again until the AI judge approves it. Re-running after
adding a page translates that page only — memory tracks what is already done, so the loop
is cheap the second time.

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
- **Never open a review canvas or ask the user to approve translations.** The user very
  likely does not speak the languages you just wrote. The AI judge is the decision-maker:
  it checks meaning, locale, register and fit against the source and component, approves
  correct translations on the user's behalf, and sends incorrect ones around again.
- Do not stop after a rejection. Continue \`translate\` → \`judge\` → \`apply\` until the
  judge approves every guardrail-clean translation in the batch.
- Continue immediately across every batch and locale. Finish one language before moving
  to the next, and do not hand control back to the user while translation work remains.
- A stage argument chooses where the run starts, not where it stops. After every
  \`apply\`, treat its displayed next command as your next internal action. Run
  \`status\` and \`audit\` at the end; claim success only when \`audit\` reports complete.
- Never invent a key. Keys come from \`extract\`.
- Do not translate an exact catalogue key \`marketing-loop\` has marked unresolved. The loop
  already excludes those keys; do not work around it or pause identical text under other keys.
- Re-running is normal and cheap. The memory file tracks what changed, so a second run
  after adding one page translates one page, not the whole app.
`;
}

export const COMMANDS: Record<string, string> = {
  'language-loop': `---
description: Run the full localization loop — scan, extract, translate, judge, apply
---

Run the language loop on this project.

A stage argument chooses where the run starts, not where it stops. For example,
\`/language-loop translate\` starts at translation and still owns every later batch and
locale. The \`npx\` forms below are terminal commands for you to run.

If the user selected only CTA/button, headline, navigation or label messages, exact content
groups, canonical keys or target locales, preserve that scope exactly. Use
\`npx language-loop orchestrate status|extract|translate\` with \`--categories\`, \`--groups\`,
\`--keys\` and \`--locales\` for the schema-1 Content Loop mirror. Never substitute an
unfiltered run. \`orchestrate translate\` requires \`--llm\`; an embedded Marketing Loop host
passes its translator and judge to \`language-loop/orchestration\` directly.

1. \`npx language-loop scan\` — report what is still hardcoded and where.
2. \`npx language-loop extract\` — move those strings into keys and wire the runtime hook.
   Read the open items it reports; the ones it refused are yours to do by hand.
3. **Optional source-copy pass:** if marketing-loop is installed, run \`npx marketing-loop propose\`,
   \`npx marketing-loop review --ui\`, then \`npx marketing-loop apply\`. marketing-loop edits only
   the source catalogue; language-loop owns extraction and every target catalogue. Exact
   unresolved catalogue keys pause translation; identical text under different keys does not.
4. \`npx language-loop translate\` — this writes \`.language-loop/brief.md\` and stops.
   The brief may contain **rework** items: strings the judge rejected on an earlier pass,
   each carrying the reason. Fix the stated problem rather than rephrasing around it.
5. **Read the brief in full.** You are the translator. For each item, open the file it
   names before you write anything — the surrounding component tells you whether a word
   is a verb or a noun, and how much room the string has. Preserve every placeholder
   exactly. Use ICU plurals where the language needs them. Write natural modern product
   language for the selected audience locale, never literal textbook prose.
6. Write \`.language-loop/translations.json\` in the schema at the bottom of the brief. Use
   the optional \`note\` field whenever you made a judgement call.
7. \`npx language-loop judge\` — writes \`.language-loop/judge.md\`. Read your own translations
   back against the source and the component, and write \`.language-loop/verdicts.json\`.
   The AI judge owns this decision because the user probably cannot read these languages.
   Approve correct translations on the user's behalf; reject only incorrect ones and give
   a concrete correction for the next autonomous pass.
8. \`npx language-loop apply\` — automated guardrails hold questionable or mechanically
   invalid translations back and write the safe translations to the catalogues. Anything
   the judge rejected is sent back rather than written.
9. **If \`apply\` reports translations sent back, go to step 4 and do another pass.** That is
   the loop closing. Repeat until nothing comes back. Never hand a rejected translation to
   the user for approval; inspect the source component, correct it, and judge it again.
10. **Continue immediately across every selected batch and locale.** Finish all selected
   strings for one language before moving to the next. Do not stop, summarize, or ask the
   user to invoke \`/language-loop\` again while selected translation work remains.

## Completion gate

After every \`apply\`, use its remaining-work count as the loop condition. When work remains,
the CLI's displayed \`next\` step is your next internal action: execute the shown \`npx\`
command immediately in this run. Do not turn an intermediate \`next\` step into a user
handoff.

When \`translate\` reports nothing left, run \`npx language-loop status\` and then
\`npx language-loop audit\`. Only send a successful final response after \`audit\` reports
complete and every selected locale is judge-approved or manual. If \`audit\` reports a
genuine blocker, finish every other selected locale first, then report that blocker instead
of claiming the translation goal is complete.
`,
  'i18n-audit': `---
description: Report what is hardcoded and how complete each language is — no changes
---

Audit this project's localization without changing anything.

Run \`npx language-loop audit\`. This command is read-only. Summarize its findings and
ordered next steps for the user, but do not execute any suggested command and make no edits.

The ordered lifecycle is scan → extract → optional \`marketing-loop propose\` →
\`marketing-loop review --ui\` → \`marketing-loop apply\` → translate → judge → apply.
language-loop owns extraction and target catalogues; marketing-loop edits only the source
catalogue. Report exact unresolved catalogue keys as waiting on marketing, never matching
strings. If marketing-loop is absent, report the standalone language-loop next step.
`,
};
