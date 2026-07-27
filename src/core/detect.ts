import fs from 'node:fs';
import path from 'node:path';
import type { CatalogLayout, Detection, Framework, Runtime } from '../types.js';
import { exists, readJson, walk } from './util.js';

interface Pkg {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Work out what this project is before touching a line of it.
 *
 * Getting this wrong is the expensive mistake: wiring next-intl into a Vite
 * React app produces a build error at best and a broken router at worst. So
 * every conclusion here is recorded with the evidence behind it, and `doctor`
 * prints that evidence back.
 */
export function detect(cwd: string): Detection {
  const pkg = readJson<Pkg>(path.join(cwd, 'package.json'), {});
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  const evidence: string[] = [];

  const framework = detectFramework(cwd, has, evidence);
  const { runtime, runtimeInstalled } = detectRuntime(has, framework, evidence);
  const srcDir = ['src', 'app', 'pages', 'components', 'lib']
    .map((d) => path.join(cwd, d))
    .find((d) => exists(d));
  const { messagesDir, layout } = detectCatalog(cwd, runtime, evidence);

  return {
    framework,
    runtime,
    messagesDir,
    layout,
    srcDir: srcDir ? path.relative(cwd, srcDir) || '.' : '.',
    runtimeInstalled,
    evidence,
  };
}

function detectFramework(cwd: string, has: (n: string) => boolean, evidence: string[]): Framework {
  if (has('next')) {
    const appRouter =
      exists(path.join(cwd, 'app')) ||
      exists(path.join(cwd, 'src/app'));
    evidence.push(`next found in package.json; ${appRouter ? 'app/ directory present' : 'no app/ directory'}`);
    return appRouter ? 'next-app' : 'next-pages';
  }
  if (has('nuxt') || has('nuxt3')) {
    evidence.push('nuxt found in package.json');
    return 'nuxt';
  }
  if (has('@sveltejs/kit')) {
    evidence.push('@sveltejs/kit found in package.json');
    return 'sveltekit';
  }
  if (has('svelte')) {
    evidence.push('svelte found in package.json');
    return 'svelte';
  }
  if (has('astro')) {
    evidence.push('astro found in package.json');
    return 'astro';
  }
  if (has('vue')) {
    evidence.push('vue found in package.json');
    return 'vue';
  }
  if (has('react')) {
    evidence.push('react found in package.json');
    return 'react';
  }
  const html = walk(cwd, { extensions: ['.html'], limit: 5 });
  if (html.length) {
    evidence.push(`no framework dependency; ${html.length} .html file(s) at the root`);
    return 'html';
  }
  evidence.push('no recognised framework in package.json');
  return 'unknown';
}

function detectRuntime(
  has: (n: string) => boolean,
  framework: Framework,
  evidence: string[]
): { runtime: Runtime; runtimeInstalled: boolean } {
  const installed: [string, Runtime][] = [
    ['next-intl', 'next-intl'],
    ['next-i18next', 'next-i18next'],
    ['react-i18next', 'react-i18next'],
    ['vue-i18n', 'vue-i18n'],
    ['svelte-i18n', 'svelte-i18n'],
    ['@inlang/paraglide-js', 'paraglide'],
  ];
  for (const [pkgName, runtime] of installed) {
    if (has(pkgName)) {
      evidence.push(`${pkgName} already installed — using it rather than introducing a second i18n runtime`);
      return { runtime, runtimeInstalled: true };
    }
  }
  if (has('i18next')) {
    evidence.push('i18next installed without a framework binding — treating as react-i18next');
    return { runtime: 'react-i18next', runtimeInstalled: true };
  }

  // Nothing installed. Recommend the one that fits the framework.
  const recommended: Record<Framework, Runtime> = {
    'next-app': 'next-intl',
    'next-pages': 'next-i18next',
    react: 'react-i18next',
    vue: 'vue-i18n',
    nuxt: 'vue-i18n',
    svelte: 'svelte-i18n',
    sveltekit: 'paraglide',
    astro: 'plain',
    html: 'plain',
    unknown: 'plain',
  };
  const runtime = recommended[framework];
  evidence.push(`no i18n runtime installed; ${runtime} is the usual fit for ${framework}`);
  return { runtime, runtimeInstalled: false };
}

function detectCatalog(
  cwd: string,
  runtime: Runtime,
  evidence: string[]
): { messagesDir: string; layout: CatalogLayout } {
  const candidates = ['messages', 'locales', 'src/locales', 'src/messages', 'public/locales', 'i18n', 'src/i18n/locales', 'lang'];
  for (const dir of candidates) {
    const full = path.join(cwd, dir);
    if (!exists(full)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(full, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasLocaleDirs = entries.some((e) => e.isDirectory() && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(e.name));
    const hasLocaleFiles = entries.some((e) => e.isFile() && /^[a-z]{2}(-[A-Za-z]{2,4})?\.json$/.test(e.name));
    if (hasLocaleDirs) {
      evidence.push(`found ${dir}/ with per-locale directories — keeping the namespaced layout you already have`);
      return { messagesDir: dir, layout: 'namespaced' };
    }
    if (hasLocaleFiles) {
      evidence.push(`found ${dir}/ with per-locale json files — keeping the single-file layout you already have`);
      return { messagesDir: dir, layout: 'single-file' };
    }
  }
  const defaults: Record<Runtime, { messagesDir: string; layout: CatalogLayout }> = {
    'next-intl': { messagesDir: 'messages', layout: 'single-file' },
    'next-i18next': { messagesDir: 'public/locales', layout: 'namespaced' },
    'react-i18next': { messagesDir: 'src/locales', layout: 'namespaced' },
    'vue-i18n': { messagesDir: 'src/locales', layout: 'single-file' },
    'svelte-i18n': { messagesDir: 'src/lib/locales', layout: 'single-file' },
    paraglide: { messagesDir: 'messages', layout: 'single-file' },
    plain: { messagesDir: 'locales', layout: 'single-file' },
  };
  const pick = defaults[runtime];
  evidence.push(`no catalogue directory found; defaulting to ${pick.messagesDir}/ for ${runtime}`);
  return pick;
}

/** The call the extractor writes into the code, per runtime. */
export function callExpression(runtime: Runtime, key: string, namespaced: boolean): string {
  switch (runtime) {
    case 'vue-i18n':
      return `$t('${key}')`;
    case 'paraglide':
      return `m.${key.replace(/[.-]/g, '_')}()`;
    default:
      return namespaced ? `t('${key}')` : `t('${key}')`;
  }
}

/** The hook or import a file needs before `t` exists in scope. */
export function hookFor(runtime: Runtime, namespace: string): { import: string; statement: string } | null {
  switch (runtime) {
    case 'next-intl':
      return {
        import: `import { useTranslations } from 'next-intl';`,
        statement: `const t = useTranslations('${namespace}');`,
      };
    case 'next-i18next':
    case 'react-i18next':
      return {
        import: `import { useTranslation } from 'react-i18next';`,
        statement: `const { t } = useTranslation('${namespace}');`,
      };
    case 'svelte-i18n':
      return {
        import: `import { t } from 'svelte-i18n';`,
        statement: '',
      };
    case 'vue-i18n':
      return null; // $t is global in templates
    case 'paraglide':
      return {
        import: `import * as m from '$lib/paraglide/messages';`,
        statement: '',
      };
    default:
      return {
        import: `import { t } from '@/lib/i18n';`,
        statement: '',
      };
  }
}
