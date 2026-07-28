import fs from 'node:fs';
import path from 'node:path';
import type { Config, TranslationUnit } from '../types.js';
import { statePath } from './config.js';
import { localeInfo } from './locales.js';

/**
 * The judge exists because the person running this loop usually cannot read
 * the languages it produces.
 *
 * The guardrails already catch everything checkable without speaking the
 * language — lost placeholders, unbalanced ICU, a button three times too long.
 * What they cannot catch is a fluent sentence that means the wrong thing, and
 * that is precisely the failure a monolingual reviewer cannot catch either.
 * So the agent reads its own work back, against the source and the component,
 * and says whether it would ship it.
 *
 * Rules run first and their casualties never reach this brief: there is no
 * point spending tokens asking for an opinion on a string that is already
 * mechanically broken.
 */

export interface JudgeInput {
  config: Config;
  /** Only units that passed the guardrails. */
  units: TranslationUnit[];
  /** Units already rejected mechanically, listed so the agent knows they exist. */
  blocked: { unit: TranslationUnit; reasons: string[] }[];
}

export function writeJudgeBrief(cwd: string, input: JudgeInput): { file: string; units: number } {
  const { config, units, blocked } = input;
  const lines: string[] = [];

  lines.push('# Judging brief');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} by language-loop.`);
  lines.push('');
  lines.push('You wrote these translations. Now read them back and decide, one by one, whether');
  lines.push('you would ship them. Write your verdicts to `.language-loop/verdicts.json` in the');
  lines.push('schema at the bottom.');
  lines.push('');
  lines.push('This is not a formality. The person running this loop very likely does not speak');
  lines.push('these languages, so your verdict is the only quality check between your translation');
  lines.push('and their users. Rejecting your own work is the point of the stage, not a failure of it.');
  lines.push('');

  lines.push('## What to reject');
  lines.push('');
  lines.push('1. **It says the wrong thing.** Fluency is not accuracy. A sentence that reads well');
  lines.push('   and means something the English did not is the worst failure here, and the one');
  lines.push('   nothing else in this loop can catch.');
  lines.push('2. **It is the wrong register.** Textbook or bureaucratic phrasing where a product');
  lines.push('   would be plain, or a formality that contradicts the one chosen for this project.');
  lines.push('3. **It ignores the place.** A regional locale promises local wording. Neutral or');
  lines.push('   academy-standard text in `pt-BR` or `es-MX` is a rejection.');
  lines.push('4. **It does not fit its slot.** A `cta` that no longer reads as a button, an `error`');
  lines.push('   that stopped explaining what to do next, an `aria` label reduced to a fragment.');
  lines.push('5. **It is untranslated.** Identical to the English when it should not be, or partly');
  lines.push('   translated with an English clause left in.');
  lines.push('');
  lines.push('## What not to reject');
  lines.push('');
  lines.push('- A choice you would have made differently but that is defensible. This is a quality');
  lines.push('  gate, not a preference poll — rejecting on taste burns a retry that a genuinely');
  lines.push('  broken string needed.');
  lines.push('- Anything mechanical. Placeholders, ICU syntax and length are already checked, and');
  lines.push('  the failures never reached this file.');
  lines.push('');
  lines.push('**Open the file each string lives in before judging it.** The component tells you');
  lines.push('whether the word is a verb or a noun, and how much room it has. Judging from the');
  lines.push('string alone reproduces the mistake the translation may have made.');
  lines.push('');

  if (blocked.length) {
    lines.push(`## Already rejected mechanically — ${blocked.length}`);
    lines.push('');
    lines.push('Listed so you know they are handled. Do not write verdicts for these.');
    lines.push('');
    for (const item of blocked.slice(0, 30)) {
      lines.push(`- \`${item.unit.key}\` · ${item.unit.locale} — ${item.reasons.join('; ')}`);
    }
    if (blocked.length > 30) lines.push(`- …and ${blocked.length - 30} more`);
    lines.push('');
  }

  lines.push(`## To judge — ${units.length}`);
  lines.push('');

  const byLocale = new Map<string, TranslationUnit[]>();
  for (const unit of units) {
    if (!byLocale.has(unit.locale)) byLocale.set(unit.locale, []);
    byLocale.get(unit.locale)!.push(unit);
  }

  for (const [locale, items] of byLocale) {
    const info = localeInfo(locale);
    lines.push(`### ${locale} — ${info.english}`);
    if (info.translationGuidance) lines.push(`*${info.translationGuidance}*`);
    lines.push('');
    for (const unit of items) {
      lines.push(`- **\`${unit.key}\`** · ${unit.kind} · \`${unit.file}\``);
      lines.push(`  - english: ${JSON.stringify(unit.source)}`);
      lines.push(`  - ${locale}: ${JSON.stringify(unit.value)}`);
      if (unit.notes) lines.push(`  - your note when you wrote it: ${unit.notes}`);
    }
    lines.push('');
  }

  lines.push('## Write your verdicts here');
  lines.push('');
  lines.push('`.language-loop/verdicts.json`:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "verdicts": [');
  lines.push('    { "key": "hero.getStartedFree", "locale": "de-DE", "ok": true },');
  lines.push('    {');
  lines.push('      "key": "errors.paymentFailed",');
  lines.push('      "locale": "de-DE",');
  lines.push('      "ok": false,');
  lines.push('      "reason": "says the payment was cancelled, not that it failed — different meaning"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('Every unit above needs a verdict. `reason` is required when `ok` is false and is');
  lines.push('handed to the next attempt verbatim — write the correction you would want to read,');
  lines.push('not "incorrect".');
  lines.push('');
  lines.push('Then run:');
  lines.push('');
  lines.push('```');
  lines.push('npx language-loop apply     # writes what passed; sends the rest back round');
  lines.push('```');
  lines.push('');

  const file = statePath(cwd, 'judge.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return { file: path.relative(cwd, file), units: units.length };
}
