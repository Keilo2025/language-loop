#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { CONFIG_FILE, defaultConfig, loadConfig, requireConfig, saveConfig, statePath } from './core/config.js';
import { detect } from './core/detect.js';
import { scanKeyUsage, scanRepo } from './core/scan.js';
import { assignKeys } from './core/keys.js';
import { applyExtraction, planExtraction } from './core/extract.js';
import {
  adoptCatalogEdits, adoptSourceEdits, deadKeys, loadMemory, pendingWork, pruneMemory, saveMemory,
  sourceCatalog, stats, syncMemory,
} from './core/memory.js';
import { writeBrief } from './core/brief.js';
import { checkTranslations, partition } from './core/guardrails.js';
import {
  collectReviewMarkdown, loadDecisions, saveDecisions, serveReview, unitId, writeReviewMarkdown,
  type Decision,
} from './core/review.js';
import { applyDecisions } from './core/apply.js';
import { detectMarketingLoop, frozenTexts, marketingLoopPitch } from './core/marketing.js';
import { AGENTS, detectAgents, installAgents, uninstallAgents } from './core/install.js';
import { wireRuntime } from './core/wire.js';
import { revertLast } from './core/backup.js';
import {
  COMMON_LOCALES, REGIONS, canonicalLocaleCode, localeInfo, localesForRegions,
  type LocaleRegion,
} from './core/locales.js';
import { resolveLocaleSelection } from './core/locale-selection.js';
import { Prompt, isInteractive } from './core/prompt.js';
import { c, commandForStage, heading, nextStep, reportScan, reportStats } from './core/report.js';
import { renderCompletenessReport } from './core/report.js';
import { analyzeCompleteness } from './core/completeness.js';
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

function commonLocaleChoices(tier: 'popular' | 'common', sourceLocale: string) {
  return COMMON_LOCALES
    .filter((locale) => locale.tier === tier && locale.code !== sourceLocale)
    .map((locale) => ({
      value: locale.code,
      label: `${locale.code.padEnd(12)} ${locale.english}`,
      hint: locale.nativeName,
    }));
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
    case 'audit': return cmdAudit();
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
    // Non-interactive: take what the flags say and leave the rest alone. A
    // re-run in CI without --agents used to unwire every agent, and without
    // --source used to reset sourceLocale to 'en' — silently, on a project
    // whose English was actually German.
    const localeArg = valueOf('--locales');
    const regionArgs = listOf('--regions');
    if (localeArg !== undefined && regionArgs.length) {
      throw new Error('Use either --locales or --regions, not both.');
    }
    if (valueOf('--source') !== undefined) config.sourceLocale = canonicalLocaleCode(valueOf('--source')!);
    if (localeArg !== undefined) {
      config.locales = resolveLocaleSelection({
        sourceLocale: config.sourceLocale,
        mode: localeArg.trim().toLowerCase() === 'all' ? 'all' : 'custom',
        codes: localeArg.trim().toLowerCase() === 'all' ? undefined : listOf('--locales'),
      });
    } else if (regionArgs.length) {
      config.locales = resolveLocaleSelection({
        sourceLocale: config.sourceLocale,
        mode: 'regions',
        regions: regionArgs,
      });
    }
    if (valueOf('--agents') !== undefined) config.agents = listOf('--agents');
    if (!config.locales.length) {
      throw new Error(
        'Not a TTY, so init needs --locales or --regions, e.g.  ' +
        'npx language-loop init --source en-US --regions europe,americas --agents cursor'
      );
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
    config.sourceLocale = canonicalLocaleCode(
      await prompt.text('\nWhat audience locale is the code written in?', 'en-US')
    );
    const selectionMode = await prompt.pick(
      '\nHow do you want to choose the languages to ship?',
      [
        { value: 'popular', label: 'Popular languages', hint: 'pick individual audience locales' },
        { value: 'regions', label: 'By region', hint: 'Africa, Americas, Asia, Europe, Middle East, Oceania' },
        { value: 'all', label: 'All common languages', hint: `${COMMON_LOCALES.length} modern written locales` },
        { value: 'custom', label: 'Enter locale codes', hint: 'any valid BCP-47 code' },
      ],
      'popular'
    );

    let selectedCodes: string[];
    if (selectionMode === 'regions') {
      const selectedRegions = await prompt.multi(
        'Which regions do you want to support?',
        REGIONS.map((region) => ({ value: region.code, label: region.label })),
        'numbers or region names, comma separated'
      );
      const regionalLocales = localesForRegions(selectedRegions as LocaleRegion[]);
      selectedCodes = await prompt.multi(
        `${regionalLocales.length} common locale(s) are used in those regions. Press Enter to keep all, or refine:`,
        regionalLocales
          .filter((locale) => locale.code !== config.sourceLocale)
          .map((locale) => ({
            value: locale.code,
            label: `${locale.code.padEnd(12)} ${locale.english}`,
            hint: locale.nativeName,
            preselected: true,
          })),
        'Enter keeps all; otherwise use numbers or locale codes'
      );
    } else if (selectionMode === 'all') {
      const confirmed = await prompt.confirm(
        `Add all ${COMMON_LOCALES.length} common modern locales? This creates a large translation backlog.`,
        false
      );
      if (!confirmed) {
        selectedCodes = await prompt.multi(
          'Choose popular audience locales instead:',
          commonLocaleChoices('popular', config.sourceLocale)
        );
      } else {
        selectedCodes = COMMON_LOCALES.map((locale) => locale.code);
      }
    } else if (selectionMode === 'custom') {
      const entered = await prompt.text(
        'Enter BCP-47 locale codes, comma separated (for example fr-CA,de-DE,ja-JP):'
      );
      selectedCodes = entered.split(',').map((code) => code.trim()).filter(Boolean);
    } else {
      selectedCodes = await prompt.multi(
        'Which popular audience locales do you want to ship?',
        commonLocaleChoices('popular', config.sourceLocale),
        'numbers or locale codes, comma separated'
      );
    }
    config.locales = resolveLocaleSelection({
      sourceLocale: config.sourceLocale,
      mode: 'custom',
      codes: selectedCodes,
    });

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
    commandForStage(config, 'scan') + '       ' + c.dim('# see what is hardcoded'),
    commandForStage(config, 'extract') + '    ' + c.dim('# move it into keys'),
    commandForStage(config, 'translate') + '  ' + c.dim('# brief your agent'),
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
  const installedIds = ids.filter((id) => AGENTS.some((agent) => agent.id === id));
  const existingConfig = loadConfig(cwd);
  if (existingConfig) {
    existingConfig.agents = [...new Set([...existingConfig.agents, ...installedIds])];
    saveConfig(cwd, existingConfig);
  }
  heading(`wired into ${ids.length} agent(s)`);
  for (const file of [...written, ...commands]) console.log(`  ${c.green('+')} ${file}`);
  nextStep([commandForStage({ agents: installedIds }, 'init') + '  ' + c.dim('# pick your languages')]);
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
    nextStep([commandForStage(config, 'extract') + '  ' + c.dim('# move these into keys')]);
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

  // What is genuinely gone, as opposed to merely already extracted. Checked
  // against the keys the code actually calls, not against this scan — a key
  // extracted last run is absent from the scan because the loop worked.
  const dead = deadKeys(memory, config, scanKeyUsage(cwd, config), new Set(keyed.map((k) => k.key)));
  const pruned = flags.has('--prune') ? pruneMemory(memory, dead) : [];

  saveMemory(cwd, memory);
  writeJson(statePath(cwd, 'open-items.json'), plan.openItems);

  heading('memory');
  console.log(`  ${c.green('+')} ${sync.added.length} new key(s)`);
  if (sync.changed.length) console.log(`  ${c.yellow('~')} ${sync.changed.length} key(s) whose English changed — their translations are now stale`);
  console.log(`  ${c.dim('=')} ${sync.unchanged.length} unchanged`);
  if (pruned.length) {
    console.log(`  ${c.red('-')} ${pruned.length} key(s) the code no longer calls — dropped`);
  } else if (dead.length) {
    console.log(`  ${c.yellow('?')} ${dead.length} key(s) the code no longer calls — kept, use --prune to drop them`);
  }
  if (result.wiringAdded) console.log(`  ${c.green('+')} ${result.wiringAdded} import(s) and hook(s) added`);
  if (result.backupId) console.log(`\n  ${c.dim(`backed up — ${commandForStage(config, 'revert')}  undoes this`)}`);

  nextStep([commandForStage(config, 'translate') + '  ' + c.dim('# brief your agent on what needs translating')]);
}

async function cmdTranslate(): Promise<void> {
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

  // One batch, decided here, and everything downstream uses it: the brief, the
  // counts on screen and the LLM request. They used to disagree — the brief was
  // truncated to maxBatch while the count and the token budget were sized off
  // the full backlog.
  const batch = usable.slice(0, config.maxBatch);
  const heldBack = usable.length - batch.length;

  const brief = writeBrief(cwd, {
    config,
    memory,
    work: batch,
    marketing,
    openItems,
    frozen: work.filter((w) => frozen.has(w.source)).map((w) => w.source),
  });
  saveMemory(cwd, memory);

  heading(`${batch.length} item(s) need translating`);
  const byLocale = new Map<string, number>();
  for (const item of batch) byLocale.set(item.locale, (byLocale.get(item.locale) ?? 0) + 1);
  for (const [locale, count] of [...byLocale].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${locale} ${c.dim(localeInfo(locale).english)}`);
  }

  console.log('');
  console.log(`  ${c.green('+')} ${brief.file}  ${c.dim(`(${brief.units} item(s))`)}`);
  if (heldBack) {
    console.log(
      c.dim(`  ${heldBack} more held back — maxBatch is ${config.maxBatch}. Run translate again after this batch lands.`)
    );
  }

  if (!marketing.installed && config.marketingLoop.enabled) {
    console.log('\n' + c.yellow('marketing-loop is not installed.') + c.dim(' You are about to translate whatever the'));
    console.log(c.dim(`English currently says. Run  ${commandForStage(config, 'sync-marketing')}  to read why that matters.`));
  }

  // Awaited, not fired and forgotten: an unawaited rejection here escapes
  // main()'s catch and buries a written-for-humans error under a stack trace.
  if (flags.has('--llm')) {
    return runLlm(config, batch);
  }

  nextStep([
    c.bold('Read .language-loop/brief.md and write .language-loop/translations.json.'),
    c.dim('You are the translator — open the files the brief names before you write.'),
    '',
    `then: ${commandForStage(config, 'review --ui')}`,
  ]);
}

async function runLlm(config: Config, work: ReturnType<typeof pendingWork>): Promise<void> {
  console.log('\n' + c.dim(`--llm: ${estimateBatch(work, config)}`));
  const result = await translateWithLlm(cwd, work, config);
  writeJson(statePath(cwd, 'translations.json'), { translations: result.translations, model: result.model });
  console.log(`  ${c.green('+')} .language-loop/translations.json  ${c.dim(`(${result.translations.length} from ${result.model})`)}`);
  nextStep([commandForStage(config, 'review --ui') + '  ' + c.dim('# a human still approves')]);
}

async function cmdReview(): Promise<void> {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);

  if (flags.has('--collect')) {
    const collected = collectReviewMarkdown(cwd);

    // The canvas re-checks whatever the reviewer typed; markdown used to go
    // straight through. A human editing a `to:` line can drop a {count} just as
    // easily as a model can, so the same guardrails apply to both paths.
    const edited: TranslationUnit[] = [];
    for (const decision of Object.values(collected)) {
      const entry = memory.entries[decision.key];
      if (!entry) continue;
      edited.push({
        key: decision.key,
        locale: decision.locale,
        source: entry.source,
        value: decision.value,
        kind: entry.kind,
        file: entry.file,
        placeholders: entry.placeholders,
        status: 'pending',
      });
    }
    const blocking = checkTranslations(edited, config).filter((i) => i.severity === 'block');
    const bad = new Set(blocking.map((i) => unitId(i.key, i.locale)));

    const decisions: Record<string, Decision> = {};
    for (const [id, decision] of Object.entries(collected)) {
      if (decision.approved && bad.has(id)) continue;
      decisions[id] = decision;
    }
    saveDecisions(cwd, decisions);

    const approved = Object.values(decisions).filter((d) => d.approved).length;
    heading(`collected ${Object.keys(decisions).length} decision(s)`);
    console.log(`  ${c.green(String(approved))} approved, ${c.dim(String(Object.keys(decisions).length - approved))} rejected`);
    if (bad.size) {
      console.log(c.red(`  ${bad.size} approved edit(s) held back — they break something mechanically:`));
      for (const issue of blocking.slice(0, 8)) {
        console.log(`    ${c.dim(`${issue.key} · ${issue.locale}`)} — ${issue.message}`);
      }
      console.log(c.dim('  Fix the `to:` line in review.md and run --collect again.'));
    }
    nextStep([commandForStage(config, 'apply')]);
    return;
  }

  const file = statePath(cwd, 'translations.json');
  if (!exists(file)) {
    throw new Error(
      'No .language-loop/translations.json.\n' +
        `Run  ${commandForStage(config, 'translate')}  first, then read the brief and write that file.`
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
      commandForStage(config, 'review --collect'),
      commandForStage(config, 'apply'),
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
  nextStep([commandForStage(config, 'apply')]);
}

function cmdApply(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);
  const decisions = loadDecisions(cwd);

  if (!Object.keys(decisions).length) {
    throw new Error(
      'No decisions to apply.\n' +
        `Run  ${commandForStage(config, 'review --ui')}  and approve something first.`
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
    console.log(`\n  ${c.dim(`${commandForStage(config, 'revert')}  undoes this`)}`);
    nextStep([commandForStage(config, 'status') + '  ' + c.dim('# coverage per language')]);
  }
}

function cmdStatus(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);

  // status reports; it does not decide. It used to adopt catalogue edits and
  // save, which meant merely asking how things were going could lock a
  // translation as `manual` — a status no later run will overwrite.
  const rewritten = adoptSourceEdits(cwd, memory, config);
  const wouldAdopt = adoptCatalogEdits(cwd, memory, config);
  reportStats(stats(memory, config), config);
  if (rewritten.length) {
    console.log('');
    console.log(c.yellow(`  ${rewritten.length} English string(s) have been edited since they were translated.`));
  }
  if (wouldAdopt) {
    console.log(c.dim(`  ${wouldAdopt} hand-written translation(s) in the catalogues not yet adopted — translate picks them up.`));
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
      commandForStage(config, scan.strings.length ? 'extract' : 'translate'),
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
    if (locale === config.sourceLocale) continue;
    const units: TranslationUnit[] = Object.entries(catalog)
      .filter(([key]) => key in source)
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

function cmdAudit(): void {
  const config = requireConfig(cwd);
  renderCompletenessReport(analyzeCompleteness(cwd, config), config);
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
    const extractCommand = config ? commandForStage(config, 'extract') : 'npx language-loop extract';
    console.log(c.dim(`  Then come back and run  ${extractCommand}  to pick up the new English.`));
  } else {
    console.log('\n  Nothing pending. The English is settled — safe to translate.');
    nextStep([config ? commandForStage(config, 'translate') : 'npx language-loop translate']);
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
  npx language-loop audit            read-only completeness report with next steps
  npx language-loop revert           undo the last run
  npx language-loop sync-marketing   check the marketing-loop handshake
  npx language-loop uninstall        remove the agent rules

${c.bold('flags')}
  --cwd <dir>        run somewhere other than here
  --dry-run          on extract and apply: show, do not write
  --locales de,fr    init: select locale codes (or "all"); translate: limit locales
  --regions europe   init: select all common locales in comma-separated regions
  --llm              translate without an agent, using ANTHROPIC_API_KEY or OPENAI_API_KEY
  --ui / --collect   canvas review, or read your ticks back out of review.md
  --prune            on extract: forget memory keys the code no longer calls
                     on apply: drop catalogue keys the code no longer has
  --all / --list     on install: every agent, or show the ids

${c.dim('Full documentation: https://github.com/keilo2000/language-loop')}
`);
}
