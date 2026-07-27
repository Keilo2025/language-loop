import type { Config } from '../types.js';
import type { CompletenessReport, SuggestedAction } from './completeness.js';
import type { MemoryStats } from './memory.js';
import type { ScanResult } from './scan.js';
import { localeInfo } from './locales.js';
import { truncate } from './util.js';

const supportsColour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const wrap = (code: number) => (s: string) => (supportsColour ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  dim: wrap(2),
  bold: wrap(1),
  green: wrap(32),
  yellow: wrap(33),
  red: wrap(31),
  cyan: wrap(36),
};

export function heading(text: string): void {
  console.log('\n' + c.bold(text));
}

export function reportScan(result: ScanResult, _config: Config): void {
  heading(`${result.strings.length} hardcoded string(s) across ${result.filesScanned} file(s)`);

  if (!result.strings.length) {
    console.log(c.dim('Nothing user-facing is hardcoded. Either the loop has already run, or the'));
    console.log(c.dim('extractor is being too cautious — check a component you know has copy in it.'));
    return;
  }

  const byFile = new Map<string, number>();
  const byKind = new Map<string, number>();
  for (const s of result.strings) {
    byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
    byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
  }

  console.log('');
  console.log(c.dim('by kind'));
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${kind}`);
  }

  console.log('');
  console.log(c.dim('heaviest files'));
  for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(count).padStart(4)}  ${file}`);
  }

  console.log('');
  console.log(c.dim('a sample'));
  for (const s of result.strings.slice(0, 8)) {
    console.log(`  ${c.dim(`${s.file}:${s.line}`)}  ${truncate(JSON.stringify(s.text), 70)}`);
  }
}

export function reportStats(stats: MemoryStats, _config: Config): void {
  heading(`${stats.keys} key(s) in the catalogue`);
  if (!stats.keys) {
    console.log(c.dim('Run  npx language-loop extract  to create some.'));
    return;
  }
  console.log('');
  console.log(c.dim('  language               coverage        missing  stale  pending  manual'));
  for (const [locale, counts] of Object.entries(stats.byLocale)) {
    const label = `${locale} ${localeInfo(locale).english}`;
    console.log(
      `  ${label.padEnd(22)} ${coverageBar(counts.coverage)} ${String(counts.coverage).padStart(3)}%  ` +
        `${String(counts.missing).padStart(7)}  ${String(counts.stale).padStart(5)}  ` +
        `${String(counts.pending).padStart(7)}  ${String(counts.manual).padStart(6)}`
    );
  }
}

function coverageBar(percent: number): string {
  const width = 12;
  const filled = Math.round((percent / 100) * width);
  const bar = '█'.repeat(filled) + '·'.repeat(width - filled);
  if (percent >= 95) return c.green(bar);
  if (percent >= 60) return c.yellow(bar);
  return c.red(bar);
}

export function nextStep(lines: string[]): void {
  console.log('');
  console.log(c.dim('next'));
  for (const line of lines) console.log(`  ${line}`);
  console.log('');
}

export function commandForAction(config: Config, action: SuggestedAction): string {
  const cursor = config.agents.includes('cursor');
  if (action === 'manual-extract') return 'Open the named files and move those strings into a shared translation helper or message map.';
  if (cursor) {
    if (action === 'review') return '/i18n-review';
    const stage: Record<Exclude<SuggestedAction, 'manual-extract' | 'review'>, string> = {
      extract: 'extract',
      setup: 'init',
      translate: 'translate',
      retranslate: 'translate',
      apply: 'apply',
      prune: 'extract --prune',
    };
    return `/language-loop ${stage[action]}`;
  }

  const stage: Record<Exclude<SuggestedAction, 'manual-extract'>, string> = {
    extract: 'extract',
    setup: 'init',
    translate: 'translate',
    retranslate: 'translate',
    review: 'review --ui',
    apply: 'apply',
    prune: 'extract --prune',
  };
  return `npx language-loop ${stage[action]}`;
}

export function renderCompletenessReport(report: CompletenessReport, config: Config): void {
  heading('language completeness');

  if (report.complete) {
    console.log('');
    console.log(`  ${c.green('complete')} — no hardcoded text, missing translations, or blocking integrity problems`);
    renderLocaleCompletion(report);
    console.log('');
    return;
  }

  const blockers = report.findings.filter((finding) => finding.severity === 'block');
  const warnings = report.findings.filter((finding) => finding.severity === 'warn');
  console.log('');
  console.log(`  ${c.red(String(blockers.length))} blocking finding(s), ${c.yellow(String(warnings.length))} warning(s)`);

  for (const finding of [...blockers, ...warnings]) {
    console.log('');
    console.log(`  ${finding.severity === 'block' ? c.red('✗') : c.yellow('!')} ${finding.message}`);
    if (finding.files.length) console.log(`    ${c.dim('files:')} ${finding.files.slice(0, 8).join(', ')}`);
    if (finding.locales.length) console.log(`    ${c.dim('locales:')} ${finding.locales.join(', ')}`);
    if (finding.keys.length) console.log(`    ${c.dim('keys:')} ${finding.keys.slice(0, 8).join(', ')}${finding.keys.length > 8 ? '…' : ''}`);
  }

  renderLocaleCompletion(report);

  heading('next steps');
  report.actions.forEach((action, index) => {
    console.log(`  ${index + 1}. ${commandForAction(config, action)}`);
  });
  console.log('');
}

function renderLocaleCompletion(report: CompletenessReport): void {
  const entries = Object.entries(report.byLocale);
  if (!entries.length) return;
  heading('selected locales');
  for (const [locale, counts] of entries) {
    const status = counts.missing || counts.stale || counts.blocked
      ? c.yellow(`${counts.coverage}%`)
      : c.green(`${counts.coverage}%`);
    console.log(
      `  ${locale.padEnd(14)} ${localeInfo(locale).english.padEnd(28)} ${status.padStart(5)}  ` +
      `${counts.missing} missing  ${counts.stale} stale  ${counts.pending} pending  ${counts.blocked} blocked`
    );
  }
}
