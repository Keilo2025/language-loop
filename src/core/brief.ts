import fs from 'node:fs';
import path from 'node:path';
import type { Config, Memory, WorkItem } from '../types.js';
import { statePath } from './config.js';
import { localeInfo } from './locales.js';
import type { MarketingLoopState } from './marketing.js';
import { truncate } from './util.js';

/**
 * The brief is the whole trick.
 *
 * There is no API key in here. Inside a coding agent, the agent *is* the
 * model: the CLI works out precisely what needs translating and what
 * constraints apply, writes it down, and the agent — which can also open the
 * component the string came from — does the language work and writes back a
 * JSON file. That is why this runs for free inside Claude Code, Cursor or
 * Codex, and why the translations are better than a machine-translation API
 * gives you: the translator can see the button the words have to fit in.
 */

export interface BriefInput {
  config: Config;
  memory: Memory;
  work: WorkItem[];
  marketing: MarketingLoopState;
  openItems: { file: string; line: number; text: string; reason: string }[];
  frozen: string[];
}

export function writeBrief(cwd: string, input: BriefInput): { file: string; units: number } {
  const { config, work, marketing, openItems, frozen } = input;
  const batch = work.slice(0, config.maxBatch);
  const lines: string[] = [];

  lines.push('# Translation brief');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} by language-loop.`);
  lines.push('');
  lines.push('You are the translator. Read this whole file, then write `.language-loop/translations.json`');
  lines.push('in the schema at the bottom. Do not edit the catalogues directly — the loop writes those');
  lines.push('after a human approves what you produce.');
  lines.push('');

  lines.push('## What this project is');
  lines.push('');
  lines.push(`- Framework: \`${config.framework}\``);
  lines.push(`- i18n runtime: \`${config.runtime}\``);
  lines.push(`- Source language: \`${config.sourceLocale}\``);
  lines.push(`- Target languages: ${config.locales.filter((l) => l !== config.sourceLocale).map((l) => `\`${l}\` (${localeInfo(l).english})`).join(', ')}`);
  lines.push(`- Catalogues live in \`${config.messagesDir}/\` (${config.layout})`);
  if (marketing.audience) lines.push(`- Audience, per marketing-loop: ${marketing.audience}`);
  lines.push('');

  lines.push('## Voice');
  lines.push('');
  lines.push(`- Tone: ${config.voice.tone}`);
  lines.push(`- Formality: ${formalityGuidance(config)}`);
  if (marketing.voice?.tone) lines.push(`- marketing-loop tone, which the translations must not contradict: ${marketing.voice.tone}`);
  if (marketing.voice?.banned?.length) {
    lines.push(`- Words banned in the source copy, and therefore in yours (including their equivalents): ${marketing.voice.banned.join(', ')}`);
  }
  if (config.voice.doNotTranslate.length) {
    lines.push(`- Never translate: ${config.voice.doNotTranslate.map((t) => `\`${t}\``).join(', ')}`);
  }
  if (Object.keys(config.voice.glossary).length) {
    lines.push('- Glossary — these renderings are fixed:');
    for (const [term, per] of Object.entries(config.voice.glossary)) {
      lines.push(`  - \`${term}\` → ${Object.entries(per).map(([l, v]) => `${l}: "${v}"`).join(', ')}`);
    }
  }
  lines.push('');

  lines.push('## Rules that are not stylistic');
  lines.push('');
  lines.push('1. **Placeholders survive exactly.** `{count}`, `{{name}}`, `%s`, `<b>…</b>` must appear in your');
  lines.push('   output character-for-character. Reorder them freely to suit the grammar; never drop, rename');
  lines.push('   or invent one. A lost placeholder is a runtime error, not a typo.');
  lines.push('2. **Plurals use ICU, not concatenation.** If the source pluralises, write');
  lines.push('   `{count, plural, one {# item} other {# items}}` and cover every category the target language');
  lines.push('   uses. Those categories are listed against each language below.');
  lines.push('3. **Respect the kind.** A `cta` is a button: the words have to fit. A `heading` can breathe.');
  lines.push('   An `error` explains what to do next, not what went wrong internally. An `aria` label is read');
  lines.push('   aloud and should be a sentence, not a fragment.');
  lines.push('4. **Translate the intent, not the words.** Write what a native user would expect in a modern app.');
  lines.push('   Avoid textbook, bureaucratic, or overly formal language unless this product explicitly calls');
  lines.push('   for it. "Get started free" means "begin, at no cost"; write the button a native product team');
  lines.push('   would ship, using the selected audience locale\'s vocabulary and spelling.');
  lines.push('5. **Open the file when you are unsure.** Each item names the file it came from. If the string is');
  lines.push('   ambiguous — "Close" the verb or "Close" the adjective — go and look.');
  lines.push('');

  lines.push('## The languages');
  lines.push('');
  lines.push('| code | language | plural categories | script | notes |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const locale of config.locales.filter((l) => l !== config.sourceLocale)) {
    const info = localeInfo(locale);
    const notes: string[] = [];
    if (info.rtl) notes.push('right-to-left');
    if (info.formalityMatters) notes.push('formality decision required');
    if (info.translationGuidance) notes.push(info.translationGuidance);
    if (info.expansion >= 1.25) notes.push(`runs ~${Math.round((info.expansion - 1) * 100)}% longer than English — keep buttons tight`);
    if (info.expansion <= 0.7) notes.push('runs much shorter than English');
    lines.push(`| \`${locale}\` | ${info.english} | ${info.plurals.join(', ')} | ${info.rtl ? 'RTL' : 'LTR'} | ${notes.join('; ') || '—'} |`);
  }
  lines.push('');

  if (frozen.length) {
    lines.push('## Frozen strings');
    lines.push('');
    lines.push(`${frozen.length} string(s) are excluded from this batch because marketing-loop has an open`);
    lines.push('rewrite for them. Translating copy that is about to change wastes the work twice over.');
    lines.push('Approve or reject those rewrites first, then re-run `npx language-loop translate`.');
    lines.push('');
  }

  lines.push(`## To translate — ${batch.length} item(s)`);
  lines.push('');
  if (work.length > batch.length) {
    lines.push(`There are ${work.length} outstanding; this brief covers the first ${batch.length}.`);
    lines.push('Run the loop again afterwards for the rest.');
    lines.push('');
  }

  const byLocale = new Map<string, WorkItem[]>();
  for (const item of batch) {
    if (!byLocale.has(item.locale)) byLocale.set(item.locale, []);
    byLocale.get(item.locale)!.push(item);
  }

  for (const [locale, items] of byLocale) {
    const info = localeInfo(locale);
    lines.push(`### ${locale} — ${info.english}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- **\`${item.key}\`** · ${item.kind} · \`${item.file}\``);
      lines.push(`  - source: ${JSON.stringify(item.source)}`);
      if (item.placeholders.length) lines.push(`  - placeholders that must survive: ${item.placeholders.map((p) => `\`${p}\``).join(' ')}`);
      if (item.reason === 'stale') {
        lines.push(`  - previous ${locale}: ${JSON.stringify(item.previous ?? '')}`);
        lines.push('  - the English changed since that was written — revise it rather than starting over');
      }
    }
    lines.push('');
  }

  if (openItems.length) {
    lines.push('## Strings the extractor would not touch');
    lines.push('');
    lines.push('These are still hardcoded. The extractor refuses to guess where it might break the build,');
    lines.push('so they are yours to move into the catalogue by hand before they can be translated.');
    lines.push('');
    for (const item of openItems.slice(0, 60)) {
      lines.push(`- \`${item.file}:${item.line}\` — ${JSON.stringify(truncate(item.text, 90))}`);
      lines.push(`  - ${item.reason}`);
    }
    lines.push('');
  }

  lines.push('## Write your output here');
  lines.push('');
  lines.push('`.language-loop/translations.json`:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "translations": [');
  lines.push('    {');
  lines.push('      "key": "hero.getStartedFree",');
  lines.push('      "locale": "de",');
  lines.push('      "value": "Kostenlos starten",');
  lines.push('      "note": "button — kept to two words so it fits the same width"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('`note` is optional and shown to the reviewer. Use it when you made a judgement call —');
  lines.push('a formality choice, a shortened button, an idiom you did not translate literally.');
  lines.push('');
  lines.push('Then run:');
  lines.push('');
  lines.push('```');
  lines.push('npx language-loop review --ui   # a human approves');
  lines.push('npx language-loop apply         # write the catalogues');
  lines.push('```');
  lines.push('');

  const file = statePath(cwd, 'brief.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return { file: path.relative(cwd, file), units: batch.length };
}

function formalityGuidance(config: Config): string {
  if (config.voice.formality === 'formal') return 'formal throughout — Sie, vous, usted';
  if (config.voice.formality === 'informal') return 'informal throughout — du, tu, tú';
  return 'pick per language what a product of this kind would use, and be consistent within a language — never mix du and Sie in one app';
}
