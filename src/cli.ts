#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE, defaultConfig, loadConfig, requireConfig, saveConfig, statePath } from './core/config.js';
import { detect } from './core/detect.js';
import { scanRepo } from './core/scan.js';
import {
  adoptCatalogEdits, adoptSourceEdits, loadMemory, needsHuman, pendingWork,
  recordVerdicts, saveMemory, sourceCatalog, stats,
} from './core/memory.js';
import { writeBrief } from './core/brief.js';
import { writeJudgeBrief } from './core/judge.js';
import { checkTranslations, partition } from './core/guardrails.js';
import { applyDecisions, type Decision } from './core/apply.js';
import {
  detectMarketingLoop,
  inspectMarketingHandoff,
  marketingLoopPitch,
  requireMarketingKeys,
} from './core/marketing.js';
import { AGENTS, detectAgents, installAgents, uninstallAgents } from './core/install.js';
import { wireRuntime } from './core/wire.js';
import { revertLast } from './core/backup.js';
import {
  AUDIENCE_LOCALES, COMMON_LOCALES, REGIONS, canonicalLocaleCode, localeInfo,
  isRtl, localesForRegions, searchLocales,
  type LocaleRegion,
} from './core/locales.js';
import { resolveLocaleSelection } from './core/locale-selection.js';
import { Prompt, isInteractive, type MultiOptions } from './core/prompt.js';
import { c, commandForStage, heading, nextStep, reportScan, reportStats } from './core/report.js';
import { renderCompletenessReport } from './core/report.js';
import { analyzeCompleteness } from './core/completeness.js';
import { exists, readJson, truncate, writeJson } from './core/util.js';
import { readCatalog, missingKeys, orphanKeys, writeCatalog } from './core/catalog.js';
import { estimateBatch, translateWithLlm } from './core/llm.js';
import { contextMap } from './core/context.js';
import { loadDotEnv } from './core/env.js';
import { ProviderRegistry } from './core/providers.js';
import { GoogleTllmProvider } from './core/providers/google-tllm.js';
import { OpenAiJudgeProvider } from './core/providers/openai-judge.js';
import {
  CONTENT_LOOP_API_VERSION,
  extractLanguageLoop,
  inspectLanguageLoop,
  runLanguageLoop,
  type LanguageLoopScopeInput,
} from './orchestration.js';
import { evaluateCorpus, loadEvalCandidates, loadEvalCorpus } from './core/eval.js';
import { pseudoCatalog, type PseudoLocale } from './core/pseudo.js';
import {
  createPlaywrightVisualDriver,
  runVisualChecks,
  type VisualViewport,
} from './core/visual.js';
import {
  bindTranslationArtifact,
  bindTranslationSubmission,
  clearBatchArtifacts,
  createBatch,
  readBatch,
  unitId,
  validateBatchAgainstMemory,
  validateTranslationArtifact,
  validateVerdictArtifact,
  writeBatch,
} from './core/batch.js';
import type {
  BoundVerdict,
  Config,
  MessageCategory,
  TranslationArtifact,
  TranslationBatch,
  TranslationUnit,
  VerdictArtifact,
} from './types.js';

const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const cwd = valueOf('--cwd') ?? process.cwd();

// Handle --version and -v before command routing
if (command === '--version' || command === '-v') {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

// A project's own .env holds the LLM keys (OPENAI_API_KEY, GOOGLE_CLOUD_*).
// Load it once at startup so every command sees it; variables already set in
// the real environment always win.
const dotenv = loadDotEnv(cwd);

function reportDotEnv(): void {
  if (!dotenv || !dotenv.keys.length) return;
  const shown = dotenv.keys.slice(0, 5).join(', ');
  const more = dotenv.keys.length > 5 ? `, …and ${dotenv.keys.length - 5} more` : '';
  console.log(c.dim(`  .env: loaded ${shown}${more}`));
}

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

function hasOption(name: string): boolean {
  return argv.includes(name) || argv.some((value) => value.startsWith(`${name}=`));
}

function orchestrationScope(): Omit<LanguageLoopScopeInput, 'cwd'> {
  const hasFilter =
    hasOption('--categories') ||
    hasOption('--groups') ||
    hasOption('--keys');
  return {
    ...(hasFilter ? {
      filter: {
        categories: listOf('--categories') as MessageCategory[],
        groups: listOf('--groups'),
        keys: listOf('--keys'),
      },
    } : {}),
    ...(hasOption('--locales') ? { locales: listOf('--locales') } : {}),
  };
}

function shellArg(value: string): string {
  if (process.platform === 'win32') return `"${value}"`;
  return `"${value.replace(/[\\$`"]/g, '\\$&')}"`;
}

function internalCommand(stage: string): string {
  return `npx language-loop ${stage} --cwd ${shellArg(path.resolve(cwd))}`;
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

/** Name a few, count the rest. Pick "all languages" and this list is 300 long. */
function summarise(codes: string[], shown = 8): string {
  if (codes.length <= shown) return codes.join(', ');
  return `${codes.slice(0, shown).join(', ')} and ${codes.length - shown} more`;
}

/**
 * The picker only shows the popular locales, because a 385-line list is not a
 * list, it is a wall. Search is what makes the rest reachable: type `swahili`,
 * `?swiss`, or `yoruba` and the matches get printed and the question asked
 * again.
 */
function localeSearchOptions(): MultiOptions {
  return {
    hint: 'numbers or locale codes, comma separated',
    legend: [
      `not listed? type a language or country — ${c.dim('swahili, swiss, brazil')} — to search all ${COMMON_LOCALES.length}`,
    ],
    resolve: (token) => {
      const query = token.replace(/^[?/]/, '');
      // A BCP-47-shaped token is a code the user means literally, not a search.
      if (!token.startsWith('?') && !token.startsWith('/') && /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(token)) {
        return null;
      }
      const matches = searchLocales(query);
      if (matches.length === 1) return { values: [matches[0]!.code] };
      if (!matches.length) {
        console.log(c.dim(`  nothing matches "${query}"`));
        return { reprompt: true };
      }
      console.log(`\n  ${matches.length} match "${query}":`);
      for (const locale of matches.slice(0, 40)) {
        console.log(`    ${locale.code.padEnd(14)} ${locale.english}  ${c.dim(locale.nativeName)}`);
      }
      if (matches.length > 40) console.log(c.dim(`    …and ${matches.length - 40} more — narrow the search`));
      console.log(c.dim('  type the codes you want, or search again'));
      return { reprompt: true };
    },
  };
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
    case 'judge': return cmdJudge();
    case 'apply': return cmdApply();
    case 'run': return cmdRun();
    case 'eval': return cmdEval();
    case 'pseudo': return cmdPseudo();
    case 'visual': return cmdVisual();
    case 'visual-check': return cmdVisual();
    case 'status': return cmdStatus();
    case 'doctor': return cmdDoctor();
    case 'audit': return cmdAudit();
    case 'revert': return cmdRevert();
    case 'sync-marketing': return cmdSyncMarketing();
    case 'orchestrate': return cmdOrchestrate();
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

async function cmdOrchestrate(): Promise<void> {
  const stage = argv[1] && !argv[1]!.startsWith('--') ? argv[1]! : 'status';
  const json = flags.has('--json');
  const scope = orchestrationScope();
  try {
    if (stage === 'status') {
      const snapshot = inspectLanguageLoop({ cwd, ...scope });
      if (json) {
        console.log(JSON.stringify(snapshot, null, 2));
      } else {
        renderOrchestrationStatus(snapshot);
      }
      if (snapshot.phase !== 'complete') process.exitCode = 2;
      return;
    }

    if (stage === 'extract') {
      const result = extractLanguageLoop({
        cwd,
        filter: scope.filter,
        keys: scope.keys,
        dryRun: flags.has('--dry-run'),
        prune: flags.has('--prune'),
      });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        heading('Content Loop · language extraction');
        console.log(`  status: ${result.status}`);
        console.log(`  selected: ${result.filter.selectedKeys.length} key(s)`);
        console.log(`  applied: ${result.applied.length}`);
        console.log(`  open items: ${result.openItems.length}`);
      }
      if (result.status === 'open-items' || result.skipped.length) process.exitCode = 2;
      return;
    }

    if (stage === 'translate') {
      if (!flags.has('--llm')) {
        orchestrationCliError(
          'INVALID_STATE',
          'orchestrate translate requires --llm or direct module adapters',
          json,
        );
        return;
      }
      const config = requireConfig(cwd);
      const registry = new ProviderRegistry()
        .registerTranslator(new GoogleTllmProvider())
        .registerJudge(new OpenAiJudgeProvider());
      const translator = registry.translator(config.ai.translator);
      const judge = registry.judge(config.ai.judge);
      const result = await runLanguageLoop({
        cwd,
        ...scope,
        dryRun: flags.has('--dry-run'),
        translator: (batch, contexts) => translator.translate({ batch, contexts, config }),
        judge: (batch, translations, units, contexts) =>
          judge.judge({ batch, translations, units, contexts, config }),
      });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        heading('Content Loop · language translation');
        console.log(`  status: ${result.status}`);
        console.log(`  selected: ${result.filter.selectedKeys.length} key(s)`);
        for (const locale of result.progress) {
          console.log(
            `  ${locale.locale}: ${locale.accepted}/${locale.total} accepted` +
            `${locale.marketingBlocked ? `, ${locale.marketingBlocked} waiting on marketing` : ''}` +
            `${locale.needsHuman ? `, ${locale.needsHuman} need human review` : ''}`,
          );
        }
      }
      if (result.status !== 'complete') process.exitCode = 2;
      return;
    }

    orchestrationCliError(
      'INVALID_STATE',
      `unknown orchestration stage "${stage}"; use status, extract, or translate`,
      json,
    );
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'INVALID_STATE';
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.replace(new RegExp(`^${code}:\\s*`), '');
    orchestrationCliError(code, message, json);
  }
}

function orchestrationCliError(code: string, message: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      apiVersion: CONTENT_LOOP_API_VERSION,
      status: 'error',
      error: { code, message },
    }, null, 2));
  } else {
    console.error(`${code}: ${message}`);
  }
  process.exitCode = 1;
}

function renderOrchestrationStatus(
  snapshot: ReturnType<typeof inspectLanguageLoop>,
): void {
  heading('Content Loop · language status');
  console.log(`  phase: ${snapshot.phase}`);
  console.log(`  next stage: ${snapshot.nextStage}`);
  console.log(`  selected: ${snapshot.filter.selectedKeys.length} key(s)`);
  console.log(`  hardcoded: ${snapshot.hardcoded}`);
  if (snapshot.marketing.selectedUnresolvedKeys.length) {
    console.log(
      `  waiting on marketing: ${snapshot.marketing.selectedUnresolvedKeys.join(', ')}`,
    );
  }
  for (const locale of snapshot.progress) {
    console.log(
      `  ${locale.locale}: ${locale.accepted}/${locale.total} accepted · ${locale.status}`,
    );
  }
  if (snapshot.error) console.log(`  ${snapshot.error.code}: ${snapshot.error.message}`);
}

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
      // `all` is the audience locales; `everything` is those plus the long tail.
      const keyword = localeArg.trim().toLowerCase();
      const bulk = keyword === 'all' || keyword === 'everything';
      config.locales = resolveLocaleSelection({
        sourceLocale: config.sourceLocale,
        mode: bulk ? (keyword as 'all' | 'everything') : 'custom',
        codes: bulk ? undefined : listOf('--locales'),
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
        { value: 'popular', label: 'Popular languages', hint: 'pick individual audience locales, or search' },
        { value: 'regions', label: 'By region', hint: 'Africa, Americas, Asia, Europe, Middle East, Oceania' },
        { value: 'all', label: 'All audience locales', hint: `${AUDIENCE_LOCALES.length} locales with a country and a dialect` },
        { value: 'everything', label: 'Every language', hint: `${COMMON_LOCALES.length}, long tail included` },
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
      // A whole region is a lot of languages. Default to the audience locales
      // in it — the ones with a dialect attached — and let people opt into the
      // long tail rather than being handed 120 backlogs by accident.
      const audience = regionalLocales.filter((locale) => locale.tier !== 'extended');
      const offered = audience.length ? audience : regionalLocales;
      selectedCodes = await prompt.multi(
        `${offered.length} audience locale(s) are used in those regions` +
          `${regionalLocales.length > offered.length ? `, out of ${regionalLocales.length} languages total` : ''}. ` +
          `Press Enter to keep all, or refine:`,
        offered
          .filter((locale) => locale.code !== config.sourceLocale)
          .map((locale) => ({
            value: locale.code,
            label: `${locale.code.padEnd(12)} ${locale.english}`,
            hint: locale.nativeName,
            preselected: true,
          })),
        {
          hint: 'Enter keeps all; otherwise use numbers or locale codes',
          legend:
            regionalLocales.length > offered.length
              ? [`type  full  to include all ${regionalLocales.length} languages in these regions`]
              : [],
          resolve: (token) =>
            token.toLowerCase() === 'full'
              ? { values: regionalLocales.map((locale) => locale.code) }
              : null,
        }
      );
    } else if (selectionMode === 'all' || selectionMode === 'everything') {
      const pool = selectionMode === 'all' ? AUDIENCE_LOCALES : COMMON_LOCALES;
      const noun = selectionMode === 'all' ? 'audience locales' : 'languages';
      const confirmed = await prompt.confirm(
        `Add all ${pool.length} ${noun}? This creates a large translation backlog.`,
        false
      );
      if (!confirmed) {
        selectedCodes = await prompt.multi(
          'Choose popular audience locales instead:',
          commonLocaleChoices('popular', config.sourceLocale),
          localeSearchOptions()
        );
      } else {
        selectedCodes = pool.map((locale) => locale.code);
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
        localeSearchOptions()
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
        `\n${summarise(formalityLangs)} distinguish formal and informal address. Which does this product use?`,
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
      console.log(c.dim('Good — the loops will hand off to each other. language-loop will skip any catalogue key'));
      console.log(c.dim('marketing-loop still has an unresolved rewrite for, and will carry your tone and banned'));
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
  const dryRun = flags.has('--dry-run');
  const result = extractLanguageLoop({
    cwd,
    dryRun,
    prune: flags.has('--prune'),
  });

  heading(`${result.filter.selectedKeys.length} string(s) selected for extraction`);

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

  if (result.openItems.length) {
    heading(`${result.openItems.length} left for you or your agent`);
    for (const item of result.openItems.slice(0, 10)) {
      console.log(`  ${c.dim(`${item.file}:${item.line}`)} ${truncate(JSON.stringify(item.text), 50)}`);
      console.log(`    ${c.dim(item.reason)}`);
    }
    if (result.openItems.length > 10) console.log(c.dim(`  …and ${result.openItems.length - 10} more, all listed in the brief`));
  }

  if (dryRun) {
    console.log('\n' + c.dim('--dry-run: nothing written.'));
    return;
  }

  heading('memory');
  console.log(`  ${c.green('+')} ${result.memory.added.length} new key(s)`);
  if (result.memory.changed.length) console.log(`  ${c.yellow('~')} ${result.memory.changed.length} key(s) whose English changed — their translations are now stale`);
  console.log(`  ${c.dim('=')} ${result.memory.unchanged.length} unchanged`);
  if (result.memory.pruned.length) {
    console.log(`  ${c.red('-')} ${result.memory.pruned.length} key(s) the code no longer calls — dropped`);
  } else if (result.memory.dead.length) {
    console.log(`  ${c.yellow('?')} ${result.memory.dead.length} key(s) the code no longer calls — kept, use --prune to drop them`);
  }
  if (result.wiringAdded) console.log(`  ${c.green('+')} ${result.wiringAdded} import(s) and hook(s) added`);
  if (result.backupId) console.log(`\n  ${c.dim(`backed up — ${commandForStage(config, 'revert')}  undoes this`)}`);

  nextStep([commandForStage(config, 'translate') + '  ' + c.dim('# brief your agent on what needs translating')]);
}

async function cmdTranslate(): Promise<void> {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);

  // Pick up target edits against the source version they were written for.
  // Generated fallbacks equal that source and must not become "manual" merely
  // because the source catalogue changed moments later.
  const adopted = adoptCatalogEdits(cwd, memory, config);
  const rewritten = adoptSourceEdits(cwd, memory, config);
  if (rewritten.length) {
    console.log(c.yellow(`${rewritten.length} English string(s) changed in ${config.messagesDir}/${config.sourceLocale}.json — their translations are now stale.`));
  }
  if (adopted) console.log(c.dim(`Adopted ${adopted} hand-written translation(s) from the catalogues; those are now locked.`));

  const only = listOf('--locales');
  const work = pendingWork(memory, config, only);
  const marketing = detectMarketingLoop(cwd);
  const marketingKeys = requireMarketingKeys(cwd, config, memory);
  const frozen = work.filter((item) => marketingKeys.has(item.key));
  const usable = work.filter((item) => !marketingKeys.has(item.key));

  if (!usable.length) {
    if (frozen.length) {
      heading('waiting for marketing review');
      console.log(c.yellow(`${frozen.length} translation key(s) are waiting for marketing review.`));
      console.log('Run npx marketing-loop review --ui, then npx marketing-loop apply.');
    } else {
      heading('nothing to translate');
      console.log(c.dim('Every key has an approved translation in every language. Add a page and run again.'));
    }
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
  // Keep each brief to one locale. Besides matching the user's mental model
  // of a language-by-language loop, this lets the judge hold one register and
  // terminology set in context instead of switching languages every item.
  const activeLocale = usable[0]!.locale;
  const activeLocaleWork = usable.filter((item) => item.locale === activeLocale);
  const batch = activeLocaleWork.slice(0, config.maxBatch);
  const heldBack = usable.length - batch.length;
  const contexts = contextMap(cwd, memory, batch);
  const manifest = createBatch(batch, {
    sourceLocale: config.sourceLocale,
    contextHashes: new Map([...contexts].map(([id, context]) => [id, context.hash])),
  });
  const cleared = clearBatchArtifacts(cwd);
  writeBatch(cwd, manifest);

  const brief = writeBrief(cwd, {
    config,
    memory,
    work: batch,
    batch: manifest,
    marketing,
    openItems,
    frozen,
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
  console.log(`  ${c.green('+')} .language-loop/batch.json  ${c.dim(`(${manifest.id})`)}`);
  if (cleared.length) console.log(c.dim(`  cleared stale ${cleared.join(', ')}`));
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
    return runLlm(config, batch, manifest);
  }

  // A new brief means a new batch, which makes every review artefact on disk
  // describe translations that no longer exist. Leaving them lets `--collect`
  // read an abandoned review.md and apply hundreds of decisions belonging to a
  // previous run — rejections included.
  const staleReview = ['review.md', 'decisions.json'].filter((file) => exists(statePath(cwd, file)));
  if (staleReview.length) {
    for (const file of staleReview) fs.rmSync(statePath(cwd, file), { force: true });
    console.log(c.dim(`\n  cleared ${staleReview.join(' and ')} — they described the previous batch`));
  }

  nextStep([
    c.bold('Read .language-loop/brief.md and write .language-loop/translations.json.'),
    c.dim('You are the translator — open the files the brief names before you write.'),
    '',
    `then: ${commandForStage(config, 'judge')}`,
  ]);
}

async function runLlm(
  config: Config,
  work: ReturnType<typeof pendingWork>,
  batch: TranslationBatch
): Promise<void> {
  console.log('\n' + c.dim(`--llm: ${estimateBatch(work, config)}`));
  reportDotEnv();
  const result = await translateWithLlm(cwd, work, config);
  const artifact = bindTranslationArtifact(batch, result.translations, `llm:${result.model}`);
  writeJson(statePath(cwd, 'translations.json'), artifact);
  console.log(`  ${c.green('+')} .language-loop/translations.json  ${c.dim(`(${result.translations.length} from ${result.model})`)}`);
  nextStep([commandForStage(config, 'judge') + '  ' + c.dim('# AI-check meaning, register and fit')]);
}

async function cmdRun(): Promise<void> {
  if (!flags.has('--llm')) {
    throw new Error(
      'The end-to-end run command requires --llm.\n' +
      'For the agent-driven workflow, run language-loop translate, judge, and apply as separate stages.'
    );
  }
  const config = requireConfig(cwd);
  const registry = new ProviderRegistry()
    .registerTranslator(new GoogleTllmProvider())
    .registerJudge(new OpenAiJudgeProvider());
  const translator = registry.translator(config.ai.translator);
  const judge = registry.judge(config.ai.judge);
  const dryRun = flags.has('--dry-run');
  const summary = await runLanguageLoop({
    cwd,
    dryRun,
    ...(hasOption('--locales') ? { locales: listOf('--locales') } : {}),
    translator: (batch, contexts) => translator.translate({ batch, contexts, config }),
    judge: (batch, translations, units, contexts) =>
      judge.judge({ batch, translations, units, contexts, config }),
  });

  heading(dryRun ? 'end-to-end LLM dry run' : 'end-to-end LLM run');
  reportDotEnv();
  console.log(`  provider: ${translator.id} → ${judge.id}`);
  console.log(
    `  ${summary.batches} batch(es), ${summary.translated} candidate(s), ${summary.applied} applied`
  );
  if (summary.rework) {
    console.log(`  ${summary.rework} candidate(s) repaired through bounded retry`);
  }
  if (summary.needsHuman) {
    console.log(
      `  ${c.yellow(String(summary.needsHuman))} translation(s) reached ai.maxAttempts and need native review`
    );
  }
  if (summary.marketingBlocked) {
    console.log(
      `  ${c.yellow(String(summary.marketingBlocked))} translation key(s) are waiting for marketing review`
    );
  }
  if (summary.status === 'waiting-marketing') {
    console.log('  Run npx marketing-loop review --ui, then npx marketing-loop apply.');
  }
  console.log(`  status: ${summary.status}`);
  if (summary.status !== 'complete' && summary.status !== 'waiting-marketing') process.exitCode = 2;
}

function cmdEval(): void {
  const localDefault = path.join(cwd, 'evals', 'multilingual.jsonl');
  const packagedDefault = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'evals',
    'multilingual.jsonl'
  );
  const corpusArg = valueOf('--corpus');
  const candidateArg = valueOf('--candidates');
  if (!candidateArg) {
    throw new Error(
      'Evaluation needs --candidates <file.jsonl>.\n' +
      'Each JSONL row must contain {"id":"corpus-id","translation":"candidate text"}.'
    );
  }
  const corpusFile = corpusArg
    ? path.resolve(cwd, corpusArg)
    : (exists(localDefault) ? localDefault : packagedDefault);
  const candidateFile = path.resolve(cwd, candidateArg);
  const report = evaluateCorpus(
    loadEvalCorpus(corpusFile),
    loadEvalCandidates(candidateFile)
  );
  const out = valueOf('--out');
  if (out) writeJson(path.resolve(cwd, out), report);
  if (flags.has('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    heading('multilingual evaluation');
    for (const [locale, result] of Object.entries(report.byLocale)) {
      console.log(
        `  ${locale}: ${result.passed}/${result.total} invariant-safe, ` +
        `${result.referenceMatches}/${result.total} exact reference`
      );
    }
    const errors = report.findings.filter((finding) => finding.severity === 'error');
    for (const finding of errors.slice(0, 20)) {
      console.log(`  ${c.red('!')} ${finding.id} · ${finding.rule} — ${finding.message}`);
    }
    if (errors.length > 20) console.log(c.dim(`  …and ${errors.length - 20} more errors`));
    console.log(`  result: ${report.ok ? c.green('pass') : c.red('fail')}`);
  }
  if (!report.ok) process.exitCode = 2;
}

function cmdPseudo(): void {
  const config = requireConfig(cwd);
  const source = readCatalog(cwd, config, config.sourceLocale);
  if (!Object.keys(source).length) {
    throw new Error(
      `The source catalogue for ${config.sourceLocale} is empty.\n` +
      'Run language-loop extract before generating pseudo-locales.'
    );
  }
  const requested = listOf('--locales');
  const locales = (requested.length ? requested : ['en-XA', 'ar-XB']) as PseudoLocale[];
  for (const locale of locales) {
    if (locale !== 'en-XA' && locale !== 'ar-XB') {
      throw new Error(`Unsupported pseudo-locale "${locale}". Use en-XA or ar-XB.`);
    }
  }

  heading(flags.has('--dry-run') ? 'pseudolocalization dry run' : 'pseudolocalization');
  for (const locale of locales) {
    const catalog = pseudoCatalog(source, locale);
    const files = flags.has('--dry-run')
      ? [catalogPathForReport(config, locale)]
      : writeCatalog(cwd, config, locale, catalog);
    console.log(
      `  ${flags.has('--dry-run') ? c.dim('would write') : c.green('+')} ` +
      `${locale}: ${Object.keys(catalog).length} key(s) → ${files.join(', ')}`
    );
  }
}

async function cmdVisual(): Promise<void> {
  const config = requireConfig(cwd);
  const url = valueOf('--url');
  if (!url) {
    throw new Error(
      'Visual validation needs --url <page>.\n' +
      'Use {locale} in the URL path, or --locale-param to select a query parameter.'
    );
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.replaceAll('{locale}', 'en-XA'));
  } catch {
    throw new Error(`Visual validation needs an absolute http(s) URL, received "${url}".`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Visual validation only opens http(s) pages, received "${parsedUrl.protocol}".`);
  }

  const requested = listOf('--locales');
  const locales = requested.length
    ? requested
    : [...new Set(['en-XA', 'ar-XB', ...config.locales.filter((locale) => isRtl(locale))])];
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(
    cwd,
    valueOf('--out-dir') ?? path.join('.language-loop', 'visual', runId)
  );
  const reportFile = path.resolve(cwd, valueOf('--out') ?? path.join(outDir, 'report.json'));
  const viewports = parseVisualViewports(valueOf('--viewport'));
  const driver = await createPlaywrightVisualDriver();
  const report = await runVisualChecks({
    url,
    locales,
    outDir,
    localeParam: valueOf('--locale-param') ?? 'locale',
    viewports,
    strict: flags.has('--strict'),
  }, driver);
  writeJson(reportFile, report);

  heading('browser localization validation');
  for (const check of report.checks) {
    console.log(
      `  ${check.locale} · ${check.viewport.name} ${check.viewport.width}×${check.viewport.height}` +
      ` · ${check.overflowCount ? c.red(`${check.overflowCount} overflow`) : c.green('fits')}`
    );
    console.log(c.dim(`    ${check.screenshot}`));
  }
  for (const finding of report.findings.slice(0, 30)) {
    const marker = finding.severity === 'error' ? c.red('!') : c.yellow('!');
    console.log(`  ${marker} ${finding.locale}/${finding.viewport} · ${finding.rule} — ${finding.message}`);
  }
  if (report.findings.length > 30) {
    console.log(c.dim(`  …and ${report.findings.length - 30} more findings`));
  }
  console.log(`  report: ${reportFile}`);
  console.log(`  result: ${report.ok ? c.green('pass') : c.red('fail')}`);
  if (!report.ok) process.exitCode = 2;
}

function parseVisualViewports(raw: string | undefined): VisualViewport[] | undefined {
  if (!raw) return undefined;
  return raw.split(',').map((value, index) => {
    const match = value.trim().match(/^(\d+)x(\d+)$/i);
    if (!match) {
      throw new Error(
        `Invalid viewport "${value}". Use WIDTHxHEIGHT, for example 390x844.`
      );
    }
    return {
      name: `custom-${index + 1}`,
      width: Number(match[1]),
      height: Number(match[2]),
    };
  });
}

function catalogPathForReport(config: Config, locale: string): string {
  return config.layout === 'namespaced'
    ? path.posix.join(config.messagesDir, locale, '*.json')
    : path.posix.join(config.messagesDir, `${locale}.json`);
}

/**
 * Rules first, agent second. Everything the guardrails can decide is decided
 * for free; only the survivors cost tokens to judge.
 */
function cmdJudge(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);
  const batch = readBatch(cwd);
  validateBatchAgainstMemory(batch, memory);

  const file = statePath(cwd, 'translations.json');
  if (!exists(file)) {
    throw new Error(
      'Nothing to judge.\n' +
        `Run  ${commandForStage(config, 'translate')}  and write .language-loop/translations.json first.`
    );
  }

  const raw = readJson<unknown>(file, null);
  const translations = bindTranslationSubmission(batch, raw);
  writeJson(file, translations);
  const batchById = new Map(batch.units.map((unit) => [unitId(unit.key, unit.locale), unit]));

  const units: TranslationUnit[] = [];
  for (const item of translations.translations) {
    const unit = batchById.get(unitId(item.key, item.locale))!;
    units.push({
      key: item.key,
      locale: item.locale,
      source: unit.source,
      value: item.value,
      kind: unit.kind,
      file: unit.file,
      placeholders: unit.placeholders,
      status: 'pending',
      notes: item.note,
    });
  }

  const issues = checkTranslations(units, config);
  const { kept, blocked } = partition(units, issues);

  heading(`${units.length} translation(s) to judge`);
  if (blocked.length) {
    console.log(c.red(`  ${blocked.length} already rejected by the guardrails — not sent to the judge`));
  }
  console.log(`  ${c.green(String(kept.length))} need a verdict`);

  const candidateById = new Map(
    translations.translations.map((item) => [unitId(item.key, item.locale), item])
  );
  const guardrailVerdicts: BoundVerdict[] = blocked.map(({ unit, issues: unitIssues }) => {
    const candidate = candidateById.get(unitId(unit.key, unit.locale))!;
    return {
      key: unit.key,
      locale: unit.locale,
      ok: false,
      reason: unitIssues.map((issue) => `${issue.rule}: ${issue.message}`).join('; '),
      sourceHash: candidate.sourceHash,
      candidateHash: candidate.candidateHash,
      by: 'guardrail',
    };
  });
  writeJson(statePath(cwd, 'verdicts.json'), {
    version: 1,
    batchId: batch.id,
    producer: 'language-loop:guardrails',
    verdicts: guardrailVerdicts,
  } satisfies VerdictArtifact);
  if (guardrailVerdicts.length) {
    const values = new Map(translations.translations.map((item) => [
      unitId(item.key, item.locale),
      item.value,
    ]));
    recordVerdicts(memory, guardrailVerdicts, values, config);
    saveMemory(cwd, memory);
  }

  if (!kept.length) {
    nextStep([commandForStage(config, 'apply')]);
    return;
  }

  const brief = writeJudgeBrief(cwd, {
    config,
    batch,
    translations,
    units: kept,
    blocked: blocked.map((b) => ({ unit: b.unit, reasons: b.issues.map((i) => i.message) })),
  });

  console.log('');
  console.log(`  ${c.green('+')} ${brief.file}  ${c.dim(`(${brief.units} to judge)`)}`);
  nextStep([
    c.bold('Read .language-loop/judge.md and write .language-loop/verdicts.json.'),
    c.dim('You are judging your own translations — open the files before you decide.'),
    '',
    `then: ${commandForStage(config, 'apply')}`,
  ]);
}

function cmdApply(): void {
  const config = requireConfig(cwd);
  const memory = loadMemory(cwd, config.sourceLocale);
  const batch = readBatch(cwd);
  validateBatchAgainstMemory(batch, memory);
  // decisions.json belonged to the removed human review canvas. Never let a
  // stale saved click override the AI judge after an upgrade.
  let decisions: Record<string, Decision> = {};
  let heldBack = 0;

  const verdictFile = statePath(cwd, 'verdicts.json');
  if (!exists(verdictFile)) {
    throw new Error(
      `AI judge verdicts missing for batch ${batch.id}.\n` +
      `Run  ${commandForStage(config, 'judge')}  and complete .language-loop/verdicts.json before apply.`
    );
  }
  const judgedValues = new Map<string, string>();

  if (!Object.keys(decisions).length) {
    const file = statePath(cwd, 'translations.json');
    if (!exists(file)) {
      throw new Error(
        'No translations to apply.\n' +
          `Run  ${commandForStage(config, 'translate')}  first, then write .language-loop/translations.json.`
      );
    }

    const translations = validateTranslationArtifact(batch, readJson<unknown>(file, null));
    const verdictArtifact = validateVerdictArtifact(
      batch,
      translations,
      readJson<unknown>(verdictFile, null)
    );
    const verdicts = verdictArtifact.verdicts;
    const batchById = new Map(batch.units.map((unit) => [unitId(unit.key, unit.locale), unit]));

    const units: TranslationUnit[] = [];
    for (const item of translations.translations) {
      const unit = batchById.get(unitId(item.key, item.locale))!;
      units.push({
        key: item.key,
        locale: item.locale,
        source: unit.source,
        value: item.value,
        kind: unit.kind,
        file: unit.file,
        placeholders: unit.placeholders,
        status: memory.entries[item.key]?.translations[item.locale]?.status === 'stale' ? 'stale' : 'pending',
        notes: item.note,
      });
      judgedValues.set(unitId(item.key, item.locale), item.value);
    }

    const issues = checkTranslations(units, config);
    const unsafe = new Set(issues.map((issue) => unitId(issue.key, issue.locale)));
    heldBack += unsafe.size;
    const verdictById = new Map(
      verdicts.map((verdict) => [unitId(verdict.key, verdict.locale), verdict])
    );
    const unsafeApproved = [...unsafe].filter((id) => verdictById.get(id)?.ok);
    if (unsafeApproved.length) {
      throw new Error(
        `Verdict artifact tries to approve mechanically unsafe translation(s): ${unsafeApproved.join(', ')}.`
      );
    }

    const rejected = new Set(
      verdicts.filter((verdict) => !verdict.ok).map((verdict) => unitId(verdict.key, verdict.locale))
    );

    decisions = Object.fromEntries(
      units
        .filter((unit) => {
          const id = unitId(unit.key, unit.locale);
          return !unsafe.has(id) && !rejected.has(id);
        })
        .map((unit) => [
          unitId(unit.key, unit.locale),
          {
            key: unit.key,
            locale: unit.locale,
            approved: true,
            value: unit.value,
            editedByHuman: false,
          } satisfies Decision,
        ])
    );
  }

  const dryRun = flags.has('--dry-run');
  const result = applyDecisions(cwd, memory, config, decisions, { dryRun, prune: flags.has('--prune') });

  // After applying, not before: applyDecisions writes the approved translations
  // into memory, and recording verdicts first would have them overwrite it.
  const persistedVerdicts = validateVerdictArtifact(
    batch,
    validateTranslationArtifact(
      batch,
      readJson<unknown>(statePath(cwd, 'translations.json'), null)
    ),
    readJson<unknown>(verdictFile, null)
  ).verdicts;
  const judgeVerdicts = persistedVerdicts.filter((verdict) => verdict.by !== 'guardrail');
  const judged = judgeVerdicts.length ? recordVerdicts(memory, judgeVerdicts, judgedValues, config) : null;
  if (judged && !dryRun) {
    saveMemory(cwd, memory);
    fs.rmSync(statePath(cwd, 'verdicts.json'), { force: true });
  }

  heading(dryRun ? 'would write' : 'written');
  for (const file of result.written) console.log(`  ${dryRun ? c.dim('·') : c.green('+')} ${file}`);

  console.log('');
  console.log(`  ${result.approved} guardrail-clean translation(s) written to the catalogues`);
  if (heldBack) console.log(`  ${c.yellow(`${heldBack} questionable or invalid translation(s) held back automatically`)}`);
  if (result.rejected) console.log(`  ${c.dim(`${result.rejected} rejected — they stay out and will be offered again next run`)}`);
  if (result.skippedManual) console.log(`  ${c.yellow(`${result.skippedManual} skipped — a human had already edited those by hand`)}`);

  if (judged) {
    if (judged.rework) {
      console.log(`  ${c.yellow(`${judged.rework} sent back to the translator with the judge's reason`)}`);
    }
  }

  for (const [locale, keys] of Object.entries(result.orphans)) {
    console.log(`  ${c.dim(`${locale}: ${keys.length} key(s) no longer in the code${flags.has('--prune') ? ' — removed' : ' — kept, use --prune to drop them'}`)}`);
  }

  if (!dryRun) {
    fs.rmSync(statePath(cwd, 'decisions.json'), { force: true });
    fs.rmSync(statePath(cwd, 'translations.json'), { force: true });
    console.log(`\n  ${c.dim(`${commandForStage(config, 'revert')}  undoes this`)}`);
    // The loop closes here: anything the judge sent back is pending again, so
    // the next `translate` picks it up with the reason attached. The same is
    // true for the rest of a large backlog: do not hand the loop back to the
    // user between batches or languages.
    const remaining = pendingWork(memory, config);
    nextStep(
      remaining.length
        ? [
            `${remaining.length} translation(s) remain; continue the autonomous loop:`,
            // This is work for the agent already running the loop, not a slash
            // command to hand back to a Cursor user. Giving the agent the
            // executable terminal command keeps the next batch in this run.
            internalCommand('translate'),
          ]
        : [commandForStage(config, 'status') + '  ' + c.dim('# coverage per language')]
    );
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
    const rework = work.filter((w) => w.reason === 'rework').length;
    console.log(`  ${c.yellow(String(work.length))} translation(s) outstanding${stale ? `, ${stale} of them stale because the English changed` : ''}${rework ? `, ${rework} sent back by the judge` : ''}`);
  }

  // A bounded autonomous loop must end somewhere. These entries have consumed
  // their configured attempts and now need a native-speaking owner.
  const stuck = needsHuman(memory);
  if (stuck.length) {
    console.log(
      `  ${c.yellow(String(stuck.length))} translation(s) reached the retry ceiling and need human/native review:`
    );
    for (const item of stuck.slice(0, 8)) {
      console.log(`    ${c.dim(`${item.key} · ${item.locale}`)} — ${item.note}`);
    }
    if (stuck.length > 8) console.log(c.dim(`    …and ${stuck.length - 8} more`));
  }

  const marketing = inspectMarketingHandoff(cwd, config, memory);
  const marketingDetail = !marketing.compatible
    ? c.yellow(' — incompatible')
    : marketing.unresolvedKeys.size
      ? c.yellow(` — waiting on marketing (${marketing.unresolvedKeys.size} unresolved key(s))`)
      : '';
  console.log(`  marketing-loop: ${marketing.installed ? c.green('installed') : c.dim('not installed')}${marketingDetail}`);

  if (!marketing.compatible) {
    nextStep(['npx marketing-loop propose']);
    return;
  }
  if (marketing.unresolvedKeys.size) {
    console.log(`  ${c.dim('keys:')} ${[...marketing.unresolvedKeys].slice(0, 10).join(', ')}${marketing.unresolvedKeys.size > 10 ? '…' : ''}`);
    nextStep(['npx marketing-loop review --ui && npx marketing-loop apply']);
    return;
  }

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
  const installation = detectMarketingLoop(cwd);

  heading('marketing-loop diagnostics');
  console.log(`  installation: ${installation.installed ? 'installed' : 'not installed'}`);
  console.log(`  run: ${installation.hasRun ? 'present' : 'absent'}`);

  if (!installation.installed) {
    console.log('  handoff schema: not available');
    console.log('  scope: not available');
    console.log('  unresolved keys: 0');
    console.log('  stale key/hash/file mismatches: none');
    console.log('  next: npx marketing-loop install');
    return;
  }

  if (installation.audience) console.log(`  audience: ${installation.audience}`);
  if (installation.voice?.tone) console.log(`  tone: ${installation.voice.tone}`);
  if (installation.voice?.banned?.length) console.log(`  banned words: ${installation.voice.banned.join(', ')}`);

  if (config) {
    config.marketingLoop.enabled = true;
    if (installation.voice?.tone && config.voice.tone.startsWith('plain and direct')) {
      config.voice.tone = installation.voice.tone;
      console.log(`\n  ${c.green('~')} adopted marketing-loop's tone into ${CONFIG_FILE}`);
    }
    saveConfig(cwd, config);
  }

  if (!config) {
    console.log('  handoff schema: not available');
    console.log('  scope: not available');
    console.log('  unresolved keys: unavailable');
    console.log('  stale key/hash/file mismatches: none');
    console.log('  next: npx language-loop init');
    return;
  }

  if (!installation.hasRun) {
    console.log('  handoff schema: not available');
    console.log('  scope: not available');
    console.log('  unresolved keys: 0');
    console.log('  stale key/hash/file mismatches: none');
    console.log('  next: npx marketing-loop propose');
    return;
  }

  const memory = loadMemory(cwd, config.sourceLocale);
  const handoff = inspectMarketingHandoff(cwd, config, memory);
  if (!handoff.compatible) {
    console.log('  handoff schema: incompatible');
    console.log('  scope: unable to validate');
    console.log('  unresolved keys: unavailable');
    console.log(`  stale key/hash/file mismatches: ${handoff.error ?? 'unknown incompatibility'}`);
    console.log('  next: npx marketing-loop propose');
    return;
  }

  console.log('  handoff schema: compatible');
  console.log('  scope: agreed');
  console.log(`  unresolved keys: ${handoff.unresolvedKeys.size}`);
  if (handoff.unresolvedKeys.size) {
    console.log('  first ten keys:');
    for (const key of [...handoff.unresolvedKeys].slice(0, 10)) console.log(`    ${key}`);
  }
  console.log('  stale key/hash/file mismatches: none');
  console.log(
    handoff.unresolvedKeys.size
      ? '  next: npx marketing-loop review --ui'
      : `  next: ${commandForStage(config, 'translate')}`
  );
}

function cmdHelp(): void {
  console.log(`
${c.bold('language-loop')} — i18n is the skeleton, l10n is the skin.

  ${c.dim('Scans your code for hardcoded words, turns them into keys, remembers what it')}
  ${c.dim('already translated, and only translates what changed. Automated guardrails hold')}
  ${c.dim('questionable or mechanically invalid translations back.')}

${c.bold('the loop')}
  npx language-loop install          wire it into the agents in this repo
  npx language-loop init             pick your agent and your languages
  npx language-loop scan             what is still hardcoded
  npx language-loop extract          move those strings into keys, wire the hook
  npx language-loop translate        write the brief; your agent does the language work
  npx language-loop judge            your agent grades its own translations
  npx language-loop apply            write what passed; send the rest back round
  npx language-loop run --llm        Google TLLM → guardrails → GPT-5.6 judge → apply
                                     (reads API keys from your project's .env automatically)
  npx language-loop orchestrate status|extract|translate
                                        stable Content Loop module/JSON CLI mirror
  npx language-loop eval             score a JSONL candidate set against the corpus
  npx language-loop pseudo           generate syntax-safe en-XA and ar-XB catalogues
  npx language-loop visual-check     screenshot overflow and RTL browser validation

${c.bold('with marketing-loop (optional)')}
  after extract: npx marketing-loop propose → review --ui → apply
  marketing-loop 0.5+ edits the source catalogue only; language-loop owns extraction and target catalogues
  exact catalogue keys waiting for marketing pause; identical text under other keys does not
  Content Loop runs continue until every selected language is judge-accepted or explicitly blocked

${c.bold('the rest')}
  npx language-loop status           coverage per language, what is stale
  npx language-loop doctor           broken placeholders, missing keys, wrong setup
  npx language-loop audit            read-only completeness report with next steps
  npx language-loop revert           undo the last run
  npx language-loop sync-marketing   check the marketing-loop handshake
  npx language-loop uninstall        remove the agent rules

${c.bold('flags')}
  --cwd <dir>        run somewhere other than here
  --dry-run          on extract, apply, run and pseudo: show, do not write
  --locales de,fr    init: locale codes, or "all" (audience locales) or
                     "everything" (every language); limit translate/run/pseudo/visual
  --regions europe   init: every locale used in comma-separated regions
  --llm              end-to-end: Google TLLM plus independent GPT-5.6 Terra judging
  --categories cta,headline
                     orchestrate: select CTA/button, headline, navigation, label, and other categories
  --groups hero,checkout
                     orchestrate: select exact catalogue namespaces/content groups
  --keys hero.start  orchestrate: select exact canonical catalogue keys
  --candidates <file> eval: JSONL translations keyed by corpus id
  --corpus <file>     eval: override the bundled multilingual corpus
  --out <file>        eval/visual: machine-readable report path
  --url <page>        visual: absolute URL; {locale} may appear in its path
  --locale-param lang visual: locale query parameter when --url has no template
  --viewport 390x844  visual: override desktop/mobile defaults; comma-separated
  --out-dir <dir>     visual: screenshot directory
  --strict            visual: make physical left/right CSS warnings release-blocking
  --prune            on extract: forget memory keys the code no longer calls
                     on apply: drop catalogue keys the code no longer has
  --all / --list     on install: every agent, or show the ids

${c.dim('Full documentation: https://github.com/keilo2000/language-loop')}
`);
}
