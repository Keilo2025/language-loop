#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { CONFIG_FILE, defaultConfig, loadConfig, requireConfig, saveConfig, statePath } from './core/config.js';
import { detect } from './core/detect.js';
import { scanRepo } from './core/scan.js';
import { assignKeys } from './core/keys.js';
import { applyExtraction, planExtraction } from './core/extract.js';
import {
  adoptCatalogEdits, adoptSourceEdits, loadMemory, pendingWork, saveMemory, sourceCatalog, stats, syncMemory,
} from './core/memory.js';
import { writeBrief } from './core/brief.js';
import { checkTranslations, partition } from './core/guardrails.js';
import {
  collectReviewMarkdown, loadDecisions, saveDecisions, serveReview, unitId, writeReviewMarkdown,
} from './core/review.js';
import { applyDecisions } from './core/apply.js';
import { detectMarketingLoop, frozenTexts, marketingLoopPitch } from './core/marketing.js';
import { AGENTS, detectAgents, installAgents, uninstallAgents } from './core/install.js';
import { wireRuntime } from './core/wire.js';
import { revertLast } from './core/backup.js';
import { LOCALES, POPULAR, localeInfo } from './core/locales.js';
import { Prompt, isInteractive } from './core/prompt.js';
import { c, heading, nextStep, reportScan, reportStats } from './core/report.js';
import { exists, readJson, truncate, writeJson } from './core/util.js';
import { readCatalog, missingKeys, orphanKeys } from './core/catalog.js';
import { estimateBatch, translateWithLlm } from './core/llm.js';
import type { Config, TranslationUnit } from './types.js';

const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const cwd = valueOf('--cwd') ?? process.cwd();

function valueOf(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  if (i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--')) return argv[i + 1];
  return undefined;
}

function listOf(name: string): string[] {
  const raw = valueOf(name);
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

main().catch((error: unknown) => {
  console.error('\n' + c.red(error instanceof Error ? error.message : String(error)) + '\n');
  process.exit(1);
});

async function main(): Promise<void> {
  switch (command) {
    case 'init': return cmdInit();
    case 'install': return cmdInstall();
    case 'uninstall': return cmdUninstall();
    case 'scan': return cmdScan();
    case 'extract': return cmdExtract();
    case 'translate': return cmdTranslate();
    case 'review': return cmdReview();
    case 'apply': return cmdApply();
    case 'status': return cmdStatus();
    case 'doctor': return cmdDoctor();
    case 'revert': return cmdRevert();
    case 'sync-marketing': return cmdSyncMarketing();
    case 'help':
    case '--help':
    case '-h': return cmdHelp();
    default:
      console.error(`Unknown command: ${command}`);
      cmdHelp();
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------

async function cmdInit(): Promise<void> {
  const detection = detect(cwd);
  const existing = loadConfig(cwd);
  const config: Config = existing ?? defaultConfig(detection);

  heading('language-loop init');
  console.log('');
  console.log(c.dim('what this project looks like'));
  for (const line of detection.evidence) console.log(`  · ${line}`);

  if (!isInteractive()) {
    // Non-interactive: take everything from flags so CI can call this.
    config.locales = listOf('--locales');
    config.sourceLocale = valueOf('--source') ?? 'en';
    config.agents = listOf('--agents');
    if (!config.locales.length) {
      throw new Error('Not a TTY, so init needs --locales, e.g.  npx language-loop init --locales de,fr,ja --agents claude');
    }
    finishInit(config, detection.runtimeInstalled);
    return;
  }

  const prompt = new Prompt();
  try {
    // 1. Agents. Asked first because it decides who is going to do the work.
    const detected = detectAgents(cwd);
    const agentChoices = AGENTS.map((a) => ({
      value: a.id,
      label: a.label,
      hint: detected.some((d) => d.id === a.id) ? 'already in this repo' : undefined,
      preselected: detected.some((d) => d.id === a.id),
    }));
    const agents = await prompt.multi(
      'Which IDE or agent do you code in? The loop writes its rules and commands there.',
      agentChoices
    );
    config.agents = agents;

    // 2. Runtime.
    config.runtime = (await prompt.pick(
      `Which i18n runtime should the code use?  ${c.dim(`(detected: ${detection.runtime}${detection.runtimeInstalled ? ', installed' : ', not installed'})`)}`,
      [
        { value: 'next-intl', label: 'next-intl', hint: 'Next.js App Router' },
        { value: 'next-i18next', label: 'next-i18next', hint: 'Next.js Pages Router' },
        { value: 'react-i18next', label: 'react-i18next', hint: 'React, Vite, CRA' },
        { value: 'vue-i18n', label: 'vue-i18n', hint: 'Vue, Nuxt' },
        { value: 'svelte-i18n', label: 'svelte-i18n', hint: 'Svelte' },
        { value: 'paraglide', label: 'paraglide', hint: 'SvelteKit, compile-time' },
        { value: 'plain', label: 'plain JSON + generated t()', hint: 'no dependency' },
      ],
      detection.runtime
    )) as Config['runtime'];

    // 3. Languages.
    config.sourceLocale = await prompt.text('\nWhat language is the code written in?', 'en');
    const localeChoices = [
      ...POPULAR.map((code) => ({ value: code, label: `${code.padEnd(6)} ${localeInfo(code).english}`, hint: localeInfo(code).name })),
      ...LOCALES.filter((l) => !POPULAR.includes(l.code) && l.code !== config.sourceLocale).map((l) => ({
        value: l.code,
        label: `${l.code.padEnd(6)} ${l.english}`,
        hint: l.name,
      })),
    ];
    config.locales = await prompt.multi(
      'Which languages do you want to ship in?',
      localeChoices,
      'numbers or codes, comma separated — any BCP-47 code works even if it is not listed'
    );
    if (!config.locales.includes(config.sourceLocale)) config.locales.unshift(config.sourceLocale);

    // 4. Formality — the decision people forget until a German user complains.
    const formalityLangs = config.locales.filter((l) => l !== config.sourceLocale && localeInfo(l).formalityMatters);
    if (formalityLangs.length) {
      config.voice.formality = (await prompt.pick(
        `\n${formalityLangs.join(', ')} distinguish formal and informal address. Which does this product use?`,
        [
          { value: 'auto', label: 'Let the translator decide per language', hint: 'consistent within each language' },
          { value: 'informal', label: 'Informal', hint: 'du, tu, tú — most consumer products' },
          { value: 'formal', label: 'Formal', hint: 'Sie, vous, usted — finance, health, enterprise' },
        ],
        'auto'
      )) as Config['voice']['formality'];
    }

    // 5. Brand terms.
    const brand = await prompt.text(
      '\nAny names that must never be translated? Product names, brand words. Comma separated, blank for none.',
      ''
    );
    config.voice.doNotTranslate = brand.split(',').map((s) => s.trim()).filter(Boolean);

    config.messagesDir = await prompt.text('\nWhere should the catalogues live?', detection.messagesDir);
    config.layout = detection.layout;
    config.framework = detection.framework;

    // 6. marketing-loop.
    const marketing = detectMarketingLoop(cwd);
    if (marketing.installed) {
      console.log('\n' + c.green('marketing-loop is installed here.'));
      console.log(c.dim('Good — the loops will hand off to each other. language-loop will skip any string'));
      console.log(c.dim('marketing-loop still has an open rewrite for, and will carry your tone and banned'));
      console.log(c.dim('words into the translation brief.'));
      config.marketingLoop.enabled = true;
    } else {
      console.log('\n' + marketingLoopPitch());
      config.marketingLoop.enabled = await prompt.confirm('\nEnable the handshake for when you install it?', true);
    }

    finishInit(config, detection.runtimeInstalled);

    if (!detection.runtimeInstalled && config.runtime !== 'plain') {
      const scaffold = await prompt.confirm(`\n${config.runtime} is not installed. Write the setup files for it?`, true);
      if (scaffold) {
        const result = wireRuntime(cwd, config);
        for (const file of result.written) console.log(`  ${c.green('+')} ${file}`);
        for (const file of result.skipped) console.log(`  ${c.dim('·')} ${file} ${c.dim('already exists, left alone')}`);
        if (result.install.length) console.log(`\n  ${c.bold('npm install ' + result.install.join(' '))}`);
        for (const note of result.notes) console.log(`  ${c.yellow('note')} ${note}`);
      }
    }
  } finally {
    prompt.close();
  }
}

function finishInit(config: Config, runtimeInstalled: boolean): void {
  saveConfig(cwd, config);
  const memory = loadMemory(cwd, config.sourceLocale);
  memory.sourceLocale = config.sourceLocale;
  saveMemory(cwd, memory);

  if (config.agents.length) {
    const { written, commands } = installAgents(cwd, config.agents);
    heading('wired into your agents');
    for (const file of written) console.log(`  ${c.green('+')} ${file}`);
    for (const file of commands) console.log(`  ${c.green('+')} ${file}`);
  }

  heading('written');
  console.log(`  ${c.green('+')} ${CONFIG_FILE}`);
  console.log(`  ${c.green('+')} .language-loop/memory.json  ${c.dim('— commit this; it is what makes re-runs cheap')}`);

  nextStep([
    'npx language-loop scan       ' + c.dim('# see what is hardcoded'),
    'npx language-loop extract    ' + c.dim('# move it into keys'),
    'npx language-loop translate  ' + c.dim('# brief your agent'),
  ]);
}

// ---------------------------------------------------------------------------

function cmdInstall(): void {
  const requested = listOf('--agents');
  const ids = flags.has('--all')
    ? AGENTS.map((a) => a.id)
    : requested.length
      ? requested
      : detectAgents(cwd).map((a) => a.id);

  if (flags.has('--list')) {
    heading('agent ids');
    for (const agent of AGENTS) console.log(`  ${agent.id.padEnd(10)} ${agent.label.padEnd(20)} ${c.dim(agent.rule)}`);
    return;
  }

  if (!ids.length) {
    console.log('No agent detected in this repo.');
    console.log('Pick one:  npx language-loop install --agents claude,cursor');
    console.log('Or all:    npx language-loop install --all');
    return;
  }

  const { written, commands } = installAgents(cwd, ids);
  heading(`wired into ${ids.length} agent(s)`);
  for (const file of [...written, ...commands]) console.log(`  ${c.green('+')} ${file}`);
  nextStep(['npx language-loop init  ' + c.dim('# pick your languages')]);
}

function cmdUninstall(): void {
  const removed = uninstallAgents(cwd);
  heading(removed.length ? `removed from ${removed.length} file(s)` : 'nothing to remove');
  for (const file of removed) console.log(`  ${c.red('-')} ${file}`);
  console.log('');
  console.log(c.dim(`${CONFIG_FILE} and .language-loop/ are left alone — delete them by hand if you mean it.`));
}

// ---------------------------------------------------------------------------

function cmdScan(): void {
  const config = requireConfig(cwd);
  const result = scanRepo(cwd, config);
  reportScan(result, config);

  if (flags.has('--json')) {
    writeJson(statePath(cwd, 'scan.json'), result.strings);
    console.log(`\n${c.dim('written')} .language-loop/scan.json`);
  }

  if (result.strings.length) {
    nextStep(['npx language-loop extract  ' + c.dim('# move these into keys')]);
  }
}

function cmdExtract(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);
  const scan = scanRepo(cwd, config);

  const marketing = detectMarketingLoop(cwd);
  const frozen = frozenTexts(marketing, config);
  const strings = scan.strings.filter((s) => !frozen.has(s.text));
  const frozenCount = scan.strings.length - strings.length;

  const keyed = assignKeys(strings, config, memory);
  const plan = planExtraction(cwd, keyed, config);
  const dryRun = flags.has('--dry-run');

  heading(`${plan.edits.length} string(s) will move into the catalogue`);
  if (frozenCount) {
    console.log(c.yellow(`  ${frozenCount} left alone — marketing-loop has an open rewrite for them.`));
  }

  const result = applyExtraction(cwd, plan, config, dryRun);

  const byFile = new Map<string, number>();
  for (const edit of result.applied) byFile.set(edit.file, (byFile.get(edit.file) ?? 0) + 1);
  for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(count).padStart(4)}  ${file}`);
  }

  if (result.skipped.length) {
    heading(`${result.skipped.length} refused`);
    for (const { edit, reason } of result.skipped.slice(0, 15)) {
      console.log(`  ${c.dim(`${edit.file}:${edit.line}`)} ${truncate(edit.before, 50)}`);
      console.log(`    ${c.yellow(reason)}`);
    }
  }

  if (plan.openItems.length) {
    heading(`${plan.openItems.length} left for you or your agent`);
    for (const item of plan.openItems.slice(0, 10)) {
      console.log(`  ${c.dim(`${item.file}:${item.line}`)} ${truncate(JSON.stringify(item.text), 50)}`);
      console.log(`    ${c.dim(item.reason)}`);
    }
    if (plan.openItems.length > 10) console.log(c.dim(`  …and ${plan.openItems.length - 10} more, all listed in the brief`));
  }

  if (dryRun) {
    console.log('\n' + c.dim('--dry-run: nothing written.'));
    return;
  }

  // Only remember what actually landed in the code.
  const applied = new Set(result.applied.map((e) => e.key));
  const landed = keyed.filter((k) => applied.has(k.key));
  const sync = syncMemory(memory, landed, config);
  saveMemory(cwd, memory);
  writeJson(statePath(cwd, 'open-items.json'), plan.openItems);

  heading('memory');
  console.log(`  ${c.green('+')} ${sync.added.length} new key(s)`);
  if (sync.changed.length) console.log(`  ${c.yellow('~')} ${sync.changed.length} key(s) whose English changed — their translations are now stale`);
  console.log(`  ${c.dim('=')} ${sync.unchanged.length} unchanged`);
  if (sync.disappeared.length) console.log(`  ${c.dim('?')} ${sync.disappeared.length} key(s) not found in the code this run`);
  if (result.wiringAdded) console.log(`  ${c.green('+')} ${result.wiringAdded} import(s) and hook(s) added`);
  if (result.backupId) console.log(`\n  ${c.dim(`backed up — npx language-loop revert  undoes this`)}`);

  nextStep(['npx language-loop translate  ' + c.dim('# brief your agent on what needs translating')]);
}

function cmdTranslate(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);

  // Pick up edits made outside the loop before deciding what still needs
  // doing. Changed English first — that is what makes translations stale —
  // then hand-written translations, which are the highest authority here.
  const rewritten = adoptSourceEdits(cwd, memory, config);
  if (rewritten.length) {
    console.log(c.yellow(`${rewritten.length} English string(s) changed in ${config.messagesDir}/${config.sourceLocale}.json — their translations are now stale.`));
  }
  const adopted = adoptCatalogEdits(cwd, memory, config);
  if (adopted) console.log(c.dim(`Adopted ${adopted} hand-written translation(s) from the catalogues; those are now locked.`));

  const only = listOf('--locales');
  const work = pendingWork(memory, config, only);
  const marketing = detectMarketingLoop(cwd);
  const frozen = frozenTexts(marketing, config);
  const usable = work.filter((w) => !frozen.has(w.source));

  if (!usable.length) {
    heading('nothing to translate');
    console.log(c.dim('Every key has an approved translation in every language. Add a page and run again.'));
    saveMemory(cwd, memory);
    return;
  }

  const openItems = readJson<{ file: string; line: number; text: string; reason: string }[]>(
    statePath(cwd, 'open-items.json'),
    []
  );

  const brief = writeBrief(cwd, {
    config,
    memory,
    work: usable,
    marketing,
    openItems,
    frozen: work.filter((w) => frozen.has(w.source)).map((w) => w.source),
  });
  saveMemory(cwd, memory);

  heading(`${usable.length} item(s) need translating`);
  const byLocale = new Map<string, number>();
  for (const item of usable) byLocale.set(item.locale, (byLocale.get(item.locale) ?? 0) + 1);
  for (const [locale, count] of [...byLocale].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${locale} ${c.dim(localeInfo(locale).english)}`);
  }

  console.log('');
  console.log(`  ${c.green('+')} ${brief.file}  ${c.dim(`(${brief.units} item(s))`)}`);

  if (!marketing.installed && config.marketingLoop.enabled) {
    console.log('\n' + c.yellow('marketing-loop is not installed.') + c.dim(' You are about to translate whatever the'));
    console.log(c.dim('English currently says. Run  npx language-loop sync-marketing  to read why that matters.'));
  }

  if (flags.has('--llm')) {
    void runLlm(config, usable);
    return;
  }

  nextStep([
    c.bold('Read .language-loop/brief.md and write .language-loop/translations.json.'),
    c.dim('You are the translator — open the files the brief names before you write.'),
    '',
    'then: npx language-loop review --ui',
  ]);
}

async function runLlm(config: Config, work: ReturnType<typeof pendingWork>): Promise<void> {
  console.log('\n' + c.dim(`--llm: ${estimateBatch(work, config)}`));
  const result = await translateWithLlm(cwd, work, config);
  writeJson(statePath(cwd, 'translations.json'), { translations: result.translations, model: result.model });
  console.log(`  ${c.green('+')} .language-loop/translations.json  ${c.dim(`(${result.translations.length} from ${result.model})`)}`);
  nextStep(['npx language-loop review --ui  ' + c.dim('# a human still approves')]);
}

async function cmdReview(): Promise<void> {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);

  if (flags.has('--collect')) {
    const decisions = collectReviewMarkdown(cwd);
    saveDecisions(cwd, decisions);
    const approved = Object.values(decisions).filter((d) => d.approved).length;
    heading(`collected ${Object.keys(decisions).length} decision(s)`);
    console.log(`  ${c.green(String(approved))} approved, ${c.dim(String(Object.keys(decisions).length - approved))} rejected`);
    nextStep(['npx language-loop apply']);
    return;
  }

  const file = statePath(cwd, 'translations.json');
  if (!exists(file)) {
    throw new Error(
      'No .language-loop/translations.json.\n' +
        'Run  npx language-loop translate  first, then read the brief and write that file.'
    );
  }

  const raw = readJson<{ translations?: { key: string; locale: string; value: string; note?: string }[] }>(file, {});
  const incoming = raw.translations ?? [];
  if (!incoming.length) throw new Error('translations.json has no "translations" array, or it is empty.');

  // A key may appear twice if the translator revised its own answer. Last wins,
  // rather than showing the reviewer the same decision twice.
  const byId = new Map<string, (typeof incoming)[number]>();
  for (const item of incoming) byId.set(`${item.key}::${item.locale}`, item);

  const units: TranslationUnit[] = [];
  const unknown: string[] = [];
  for (const item of byId.values()) {
    const entry = memory.entries[item.key];
    if (!entry) {
      unknown.push(item.key);
      continue;
    }
    units.push({
      key: item.key,
      locale: item.locale,
      source: entry.source,
      value: item.value,
      kind: entry.kind,
      file: entry.file,
      placeholders: entry.placeholders,
      status: entry.translations[item.locale]?.status === 'stale' ? 'stale' : 'pending',
      notes: item.note,
    });
  }

  const issues = checkTranslations(units, config);
  const { kept, blocked, flagged } = partition(units, issues);

  heading(`${units.length} translation(s) came back`);
  if (unknown.length) {
    console.log(c.yellow(`  ${unknown.length} for key(s) that do not exist — ignored: ${unknown.slice(0, 5).join(', ')}`));
  }
  if (blocked.length) {
    console.log(c.red(`  ${blocked.length} blocked by guardrails before you see them:`));
    for (const { unit, issues: unitIssues } of blocked.slice(0, 8)) {
      console.log(`    ${c.dim(`${unit.key} · ${unit.locale}`)} — ${unitIssues.map((i) => i.message).join('; ')}`);
    }
  }
  if (flagged.size) console.log(c.yellow(`  ${flagged.size} flagged for a closer look`));
  console.log(`  ${c.green(String(kept.length))} ready for you`);

  const bundle = { units: kept, issues: flagged, blocked };

  if (!flags.has('--ui')) {
    const md = writeReviewMarkdown(cwd, bundle, config, memory);
    heading('markdown review');
    console.log(`  ${c.green('+')} ${md}`);
    nextStep([
      'tick the boxes, edit any "to:" line you disagree with, then:',
      'npx language-loop review --collect',
      'npx language-loop apply',
    ]);
    return;
  }

  const port = Number.parseInt(valueOf('--port') ?? '4747', 10);
  const server = await serveReview(cwd, bundle, config, memory, port);
  heading('review canvas');
  console.log(`  ${c.cyan(server.url)}`);
  console.log(c.dim('  j/k to move, a to approve, r to reject. Edit any translation directly.'));
  console.log(c.dim('  Your job is the decisions, not the grammar: does the button still fit, did the'));
  console.log(c.dim('  brand name survive, is the formality right for this product.'));
  console.log('');
  console.log(c.dim('  Waiting for you to hit Save…'));

  const decisions = await server.done;
  server.close();
  const approved = Object.values(decisions).filter((d) => d.approved).length;
  console.log(`\n  ${c.green(String(approved))} approved, ${c.dim(String(Object.keys(decisions).length - approved))} rejected`);
  nextStep(['npx language-loop apply']);
}

function cmdApply(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);
  const decisions = loadDecisions(cwd);

  if (!Object.keys(decisions).length) {
    throw new Error(
      'No decisions to apply.\n' +
        'Run  npx language-loop review --ui  (or  review  then  review --collect) and approve something first.'
    );
  }

  const dryRun = flags.has('--dry-run');
  const result = applyDecisions(cwd, memory, config, decisions, { dryRun, prune: flags.has('--prune') });

  heading(dryRun ? 'would write' : 'written');
  for (const file of result.written) console.log(`  ${dryRun ? c.dim('·') : c.green('+')} ${file}`);

  console.log('');
  console.log(`  ${result.approved} translation(s) approved into the catalogues`);
  if (result.rejected) console.log(`  ${c.dim(`${result.rejected} rejected — they stay out and will be offered again next run`)}`);
  if (result.skippedManual) console.log(`  ${c.yellow(`${result.skippedManual} skipped — a human had already edited those by hand`)}`);

  for (const [locale, keys] of Object.entries(result.orphans)) {
    console.log(`  ${c.dim(`${locale}: ${keys.length} key(s) no longer in the code${flags.has('--prune') ? ' — removed' : ' — kept, use --prune to drop them'}`)}`);
  }

  if (!dryRun) {
    fs.rmSync(statePath(cwd, 'decisions.json'), { force: true });
    fs.rmSync(statePath(cwd, 'translations.json'), { force: true });
    console.log(`\n  ${c.dim('npx language-loop revert  undoes this')}`);
    nextStep(['npx language-loop status  ' + c.dim('# coverage per language')]);
  }
}

function cmdStatus(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);
  const rewritten = adoptSourceEdits(cwd, memory, config);
  adoptCatalogEdits(cwd, memory, config);
  saveMemory(cwd, memory);
  reportStats(stats(memory, config), config);
  if (rewritten.length) {
    console.log('');
    console.log(c.yellow(`  ${rewritten.length} English string(s) have been edited since they were translated.`));
  }

  const work = pendingWork(memory, config);
  const scan = scanRepo(cwd, config);

  console.log('');
  if (scan.strings.length) {
    console.log(`  ${c.yellow(String(scan.strings.length))} string(s) still hardcoded in the code`);
  } else {
    console.log(`  ${c.green('nothing')} hardcoded — the skeleton is clean`);
  }
  if (work.length) {
    const stale = work.filter((w) => w.reason === 'stale').length;
    console.log(`  ${c.yellow(String(work.length))} translation(s) outstanding${stale ? `, ${stale} of them stale because the English changed` : ''}`);
  }

  const marketing = detectMarketingLoop(cwd);
  console.log(`  marketing-loop: ${marketing.installed ? c.green('installed') : c.dim('not installed')}${marketing.pendingTexts.length ? c.yellow(` — ${marketing.pendingTexts.length} copy rewrite(s) pending, those strings are frozen`) : ''}`);

  if (scan.strings.length || work.length) {
    nextStep([
      scan.strings.length ? 'npx language-loop extract' : 'npx language-loop translate',
    ]);
  }
}

function cmdDoctor(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);
  const detection = detect(cwd);

  heading('setup');
  for (const line of detection.evidence) console.log(`  · ${line}`);
  if (detection.runtime !== config.runtime) {
    console.log(`  ${c.yellow('!')} config says ${config.runtime}, the project looks like ${detection.runtime}`);
  }
  if (!detection.runtimeInstalled && config.runtime !== 'plain') {
    console.log(`  ${c.yellow('!')} ${config.runtime} is not in package.json — the code calls t() but nothing defines it`);
  }

  const source = sourceCatalog(memory);
  let problems = 0;

  heading('catalogues');
  for (const locale of config.locales) {
    const catalog = readCatalog(cwd, config, locale);
    const missing = missingKeys(source, catalog);
    const orphans = orphanKeys(source, catalog);
    const line = [
      `${locale.padEnd(6)}`,
      `${String(Object.keys(catalog).length).padStart(5)} key(s)`,
      missing.length ? c.yellow(`${missing.length} missing`) : c.green('complete'),
      orphans.length ? c.dim(`${orphans.length} orphaned`) : '',
    ].filter(Boolean).join('  ');
    console.log(`  ${line}`);
    problems += missing.length ? 1 : 0;

    // Integrity of what is already shipped, not just what is about to be.
    const units: TranslationUnit[] = Object.entries(catalog)
      .filter(([key]) => key in source && locale !== config.sourceLocale)
      .map(([key, value]) => ({
        key,
        locale,
        source: source[key]!,
        value,
        kind: memory.entries[key]?.kind ?? 'unknown',
        file: memory.entries[key]?.file ?? '',
        placeholders: memory.entries[key]?.placeholders ?? [],
        status: 'approved' as const,
      }));
    const issues = checkTranslations(units, config).filter((i) => i.severity === 'block');
    for (const issue of issues.slice(0, 8)) {
      console.log(`    ${c.red('✗')} ${issue.key} — ${issue.message}`);
      problems++;
    }
    if (issues.length > 8) console.log(c.dim(`    …and ${issues.length - 8} more`));
  }

  console.log('');
  console.log(problems ? c.yellow(`${problems} problem(s) worth fixing.`) : c.green('Nothing broken.'));
}

function cmdRevert(): void {
  const result = revertLast(cwd);
  if (!result) {
    console.log('Nothing to revert — no backup from a previous run.');
    return;
  }
  heading(`reverted ${result.id}`);
  console.log(`  ${result.restored} file(s) restored, ${result.removed} removed`);
  console.log(c.dim('\n  The memory file is not rolled back. Run  scan  and  extract  again to resync it.'));
}

function cmdSyncMarketing(): void {
  const config = loadConfig(cwd);
  const state = detectMarketingLoop(cwd);

  if (!state.installed) {
    console.log('\n' + marketingLoopPitch() + '\n');
    return;
  }

  heading('marketing-loop');
  console.log(`  installed${state.hasRun ? ', and it has run here' : ', not run yet'}`);
  if (state.audience) console.log(`  audience: ${state.audience}`);
  if (state.voice?.tone) console.log(`  tone: ${state.voice.tone}`);
  if (state.voice?.banned?.length) console.log(`  banned words: ${state.voice.banned.join(', ')}`);
  console.log(`  ${state.pendingTexts.length} copy rewrite(s) pending`);

  if (config) {
    config.marketingLoop.enabled = true;
    if (state.voice?.tone && config.voice.tone.startsWith('plain and direct')) {
      config.voice.tone = state.voice.tone;
      console.log(`\n  ${c.green('~')} adopted marketing-loop's tone into ${CONFIG_FILE}`);
    }
    saveConfig(cwd, config);
  }

  if (state.pendingTexts.length) {
    console.log('');
    console.log(c.yellow('  Those strings are frozen. Approve or reject the rewrites first:'));
    console.log('    npx marketing-loop review --ui');
    console.log('    npx marketing-loop apply');
    console.log(c.dim('  Then come back and run  npx language-loop extract  to pick up the new English.'));
  } else {
    console.log('\n  Nothing pending. The English is settled — safe to translate.');
    nextStep(['npx language-loop translate']);
  }
}

function cmdHelp(): void {
  console.log(`
${c.bold('language-loop')} — i18n is the skeleton, l10n is the skin.

  ${c.dim('Scans your code for hardcoded words, turns them into keys, remembers what it')}
  ${c.dim('already translated, and only translates what changed. A human approves before')}
  ${c.dim('anything ships.')}

${c.bold('the loop')}
  npx language-loop install          wire it into the agents in this repo
  npx language-loop init             pick your agent and your languages
  npx language-loop scan             what is still hardcoded
  npx language-loop extract          move those strings into keys, wire the hook
  npx language-loop translate        write the brief; your agent does the language work
  npx language-loop review --ui      a human approves, on a canvas
  npx language-loop apply            write the catalogues

${c.bold('the rest')}
  npx language-loop status           coverage per language, what is stale
  npx language-loop doctor           broken placeholders, missing keys, wrong setup
  npx language-loop revert           undo the last run
  npx language-loop sync-marketing   check the marketing-loop handshake
  npx language-loop uninstall        remove the agent rules

${c.bold('flags')}
  --cwd <dir>        run somewhere other than here
  --dry-run          on extract and apply: show, do not write
  --locales de,fr    limit translate to some languages
  --llm              translate without an agent, using ANTHROPIC_API_KEY or OPENAI_API_KEY
  --ui / --collect   canvas review, or read your ticks back out of review.md
  --prune            on apply: drop catalogue keys the code no longer has
  --all / --list     on install: every agent, or show the ids

${c.dim('Full documentation: https://github.com/keilo2000/language-loop')}
`);
}
