import fs from 'node:fs';
import path from 'node:path';
import type { Config, Edit, KeyedString, Runtime } from '../types.js';
import { hookFor } from './detect.js';
import { leafOf } from './keys.js';
import { Backup } from './backup.js';

/**
 * Replace the words in the code with keys — the i18n half of the job.
 *
 * This is the only part of the loop that rewrites source. It is therefore the
 * paranoid part: exact-match replacement, one occurrence, a backup of every
 * file touched, and a flat refusal to guess when a file does not look like
 * something it understands. What it refuses becomes an open item for the agent
 * rather than a silent skip.
 */

/** Runtimes where `useTranslations('ns')` scopes the call, so code holds the leaf key. */
const NAMESPACE_HOOKS: Runtime[] = ['next-intl', 'next-i18next', 'react-i18next'];

export interface ExtractPlan {
  edits: Edit[];
  /** Files that need a hook or import added before `t` exists in scope. */
  wiring: { file: string; namespace: string; import: string; statement: string; component?: string }[];
  /** Strings the extractor will not touch, with the reason, for the brief. */
  openItems: { file: string; line: number; text: string; reason: string }[];
}

export function planExtraction(cwd: string, strings: KeyedString[], config: Config): ExtractPlan {
  const edits: Edit[] = [];
  const openItems: ExtractPlan['openItems'] = [];
  const wiring: ExtractPlan['wiring'] = [];
  const scoped = NAMESPACE_HOOKS.includes(config.runtime);
  const seenWiring = new Set<string>();

  for (const s of strings) {
    const codeKey = scoped ? leafOf(s.key) : s.key;
    const call = callFor(config.runtime, codeKey, s.context);

    if (!call) {
      openItems.push({
        file: s.file,
        line: s.line,
        text: s.text,
        reason: `no ${config.runtime} call form for a ${s.context} string — needs a hand-written rewrite`,
      });
      continue;
    }

    // Interpolated copy needs values passed to t(), which is a judgement call
    // about where those values live. Hand it over rather than guess.
    if (s.placeholders.length) {
      openItems.push({
        file: s.file,
        line: s.line,
        text: s.text,
        reason: `contains ${s.placeholders.join(', ')} — needs ICU arguments wired into the call by hand`,
      });
      continue;
    }

    // A literal declared at module scope cannot call a hook. Rewriting it
    // produces code that compiles and then throws at import time, which is a
    // worse outcome than leaving it alone and saying so.
    if (s.context === 'literal' && s.scope === 'module') {
      openItems.push({
        file: s.file,
        line: s.line,
        text: s.text,
        reason:
          'declared outside any component, where the translation hook is not in scope — ' +
          'move the array inside the component, or turn it into a function that takes `t`',
      });
      continue;
    }

    const before = s.context.endsWith('attr') || s.context === 'literal' ? s.raw : s.text;
    const after =
      s.context === 'literal'
        ? `${s.attr}: ${call}`
        : s.context.endsWith('attr')
          ? attrReplacement(s.attr!, call, config.runtime, s.context)
          : call;

    edits.push({
      file: s.file,
      line: s.line,
      before,
      after,
      key: s.key,
      reason: `${s.kind} moved into the catalogue as ${s.key}`,
    });

    const hook = hookFor(config.runtime, s.namespace);
    if (hook && !s.context.startsWith('vue') && !s.context.startsWith('html')) {
      const id = `${s.file}::${s.namespace}::${s.component ?? ''}`;
      if (!seenWiring.has(id)) {
        seenWiring.add(id);
        wiring.push({ file: s.file, namespace: s.namespace, import: hook.import, statement: hook.statement, component: s.component });
      }
    }
  }

  return { edits, wiring, openItems };
}

export interface ExtractResult {
  applied: Edit[];
  skipped: { edit: Edit; reason: string }[];
  filesTouched: string[];
  wiringAdded: number;
  backupId: string | null;
}

export function applyExtraction(cwd: string, plan: ExtractPlan, config: Config, dryRun = false): ExtractResult {
  const backup = new Backup(cwd, 'extract');
  const byFile = new Map<string, Edit[]>();
  for (const edit of plan.edits) {
    if (!byFile.has(edit.file)) byFile.set(edit.file, []);
    byFile.get(edit.file)!.push(edit);
  }

  const applied: Edit[] = [];
  const skipped: ExtractResult['skipped'] = [];
  const filesTouched: string[] = [];
  let wiringAdded = 0;

  for (const [file, edits] of byFile) {
    if (config.protectedFiles.includes(file)) {
      for (const edit of edits) skipped.push({ edit, reason: 'file is in protectedFiles' });
      continue;
    }
    const full = path.join(cwd, file);
    let content: string;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      for (const edit of edits) skipped.push({ edit, reason: 'file could not be read' });
      continue;
    }

    const lines = content.split('\n');
    let changed = false;

    // Work bottom-up so earlier line numbers stay valid.
    for (const edit of [...edits].sort((a, b) => b.line - a.line)) {
      const idx = edit.line - 1;
      const line = lines[idx];
      if (line === undefined || !line.includes(edit.before)) {
        // Line numbers drift when a file is edited between scan and extract.
        // Refusing beats rewriting the wrong line.
        skipped.push({ edit, reason: 'source no longer matches — re-run scan' });
        continue;
      }
      const occurrences = line.split(edit.before).length - 1;
      if (occurrences > 1 && edit.before.length < 4) {
        skipped.push({ edit, reason: 'text appears more than once on the line and is too short to disambiguate' });
        continue;
      }
      lines[idx] = line.replace(edit.before, edit.after);
      applied.push(edit);
      changed = true;
    }

    if (!changed) continue;

    let next = lines.join('\n');
    const fileWiring = plan.wiring.filter((w) => w.file === file);
    if (fileWiring.length) {
      const wired = addWiring(next, fileWiring, config.runtime);
      if (wired.ok) {
        next = wired.content;
        wiringAdded += wired.inserted;
      } else {
        plan.openItems.push({
          file,
          line: 1,
          text: '(file wiring)',
          reason: `could not find a component body to put "${fileWiring[0]!.statement}" in — add it by hand`,
        });
      }
    }

    filesTouched.push(file);
    if (!dryRun) {
      backup.capture(file);
      fs.writeFileSync(full, next, 'utf8');
    }
  }

  return { applied, skipped, filesTouched, wiringAdded, backupId: dryRun ? null : backup.commit() };
}

// ---------------------------------------------------------------------------

function callFor(runtime: Runtime, key: string, context: KeyedString['context']): string | null {
  const safeKey = key.replace(/'/g, "\\'");
  switch (context) {
    case 'jsx-text':
      if (runtime === 'paraglide') return `{m.${key.replace(/[.-]/g, '_')}()}`;
      if (runtime === 'svelte-i18n') return `{$t('${safeKey}')}`;
      return `{t('${safeKey}')}`;
    case 'jsx-attr':
      if (runtime === 'paraglide') return `m.${key.replace(/[.-]/g, '_')}()`;
      if (runtime === 'svelte-i18n') return `$t('${safeKey}')`;
      return `t('${safeKey}')`;
    case 'vue-text':
      return `{{ $t('${safeKey}') }}`;
    case 'vue-attr':
      return `$t('${safeKey}')`;
    case 'literal':
      if (runtime === 'paraglide') return `m.${key.replace(/[.-]/g, '_')}()`;
      return `t('${safeKey}')`;
    case 'html-text':
    case 'html-attr':
      // Plain HTML has no runtime to call into. The agent decides whether the
      // page becomes a template or a component.
      return null;
    default:
      return null;
  }
}

function attrReplacement(attr: string, call: string, runtime: Runtime, context: KeyedString['context']): string {
  if (context === 'vue-attr') return `:${attr}="${call}"`;
  return `${attr}={${call}}`;
}

/**
 * Put the import at the top and the hook inside the component.
 *
 * Only patterns we can recognise with confidence get wired: a named function
 * component, or an arrow component assigned to a capitalised const. Anything
 * else is reported rather than guessed at.
 */
function addWiring(
  content: string,
  wiring: ExtractPlan['wiring'],
  runtime: Runtime
): { content: string; ok: boolean; inserted: number } {
  let next = content;
  let inserted = 0;

  const importLine = wiring[0]!.import;
  if (importLine && !next.includes(importLine.split(' from ')[0]!.replace('import ', '').trim())) {
    const lastImport = [...next.matchAll(/^import\s.*?;?\s*$/gm)].pop();
    if (lastImport) {
      const at = lastImport.index! + lastImport[0].length;
      next = next.slice(0, at) + '\n' + importLine + next.slice(at);
    } else {
      const directive = /^(['"])use (client|server)\1;?\s*$/m.exec(next);
      const at = directive ? directive.index + directive[0].length : 0;
      next = next.slice(0, at) + (at ? '\n\n' : '') + importLine + (at ? '' : '\n') + next.slice(at);
    }
    inserted++;
  }

  for (const w of wiring) {
    if (!w.statement) continue;
    if (next.includes(w.statement)) continue;

    const patterns = w.component
      ? [
          new RegExp(`(function\\s+${w.component}\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{)`),
          new RegExp(`(const\\s+${w.component}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::[^=]+)?=>\\s*\\{)`),
        ]
      : [/(export\s+default\s+function\s+\w*\s*\([^)]*\)\s*\{)/, /(function\s+[A-Z]\w*\s*\([^)]*\)\s*\{)/];

    let done = false;
    for (const re of patterns) {
      const m = re.exec(next);
      if (!m) continue;
      const at = m.index + m[0].length;
      const indent = '  ';
      next = next.slice(0, at) + `\n${indent}${w.statement}` + next.slice(at);
      inserted++;
      done = true;
      break;
    }
    // A file whose hook is already in place needs nothing; a file where no
    // recognisable component could be found needs a human. Only the second is
    // a failure, and conflating them makes the loop cry wolf on every re-run.
    if (!done) return { content, ok: false, inserted: 0 };
  }

  return { content: next, ok: true, inserted };
}
