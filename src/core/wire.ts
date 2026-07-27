import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../types.js';
import { exists } from './util.js';
import { isRtl } from './locales.js';

/**
 * Stand up the runtime, if the project does not have one yet.
 *
 * Deliberately minimal. This writes the smallest correct setup for the
 * detected stack and nothing more — no locale-switcher component, no opinions
 * about routing beyond what the runtime requires. A generated file that has to
 * be unpicked is worse than one you had to write.
 *
 * Nothing here overwrites a file that already exists.
 */

export interface WireResult {
  written: string[];
  skipped: string[];
  install: string[];
  notes: string[];
}

export function wireRuntime(cwd: string, config: Config): WireResult {
  const result: WireResult = { written: [], skipped: [], install: [], notes: [] };
  const files = filesFor(config);

  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(cwd, rel);
    if (exists(full)) {
      result.skipped.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    result.written.push(rel);
  }

  switch (config.runtime) {
    case 'next-intl':
      result.install.push('next-intl');
      result.notes.push('next-intl needs `createNextIntlPlugin` in next.config — add it if you have not already.');
      break;
    case 'react-i18next':
    case 'next-i18next':
      result.install.push('i18next', 'react-i18next');
      result.notes.push('Import `./i18n` once, at the top of your app entry point, before anything renders.');
      break;
    case 'vue-i18n':
      result.install.push('vue-i18n');
      break;
    case 'svelte-i18n':
      result.install.push('svelte-i18n');
      break;
    case 'paraglide':
      result.install.push('@inlang/paraglide-js');
      result.notes.push('Paraglide compiles messages at build time — run its compiler after every `apply`.');
      break;
    default:
      break;
  }

  if (config.locales.some((l) => isRtl(l))) {
    result.notes.push(
      `You have a right-to-left language (${config.locales.filter(isRtl).join(', ')}). Set dir="rtl" on <html> ` +
        'for those locales — translating the words without flipping the layout produces a page that reads backwards.'
    );
  }

  return result;
}

function filesFor(config: Config): Record<string, string> {
  const locales = JSON.stringify(config.locales);
  const source = config.sourceLocale;

  switch (config.runtime) {
    case 'next-intl':
      return {
        'i18n/routing.ts': `import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ${locales},
  defaultLocale: '${source}',
});
`,
        'i18n/request.ts': `import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.includes(requested as never) ? requested! : routing.defaultLocale;

  return {
    locale,
    messages: (await import(\`../${config.messagesDir}/\${locale}.json\`)).default,
  };
});
`,
        'middleware.ts': `import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\\\..*).*)'],
};
`,
      };

    case 'react-i18next':
    case 'next-i18next':
      return {
        'src/i18n.ts': `import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

${config.locales
  .map((l) => `import ${varName(l)} from '../${config.messagesDir}/${l}.json';`)
  .join('\n')}

i18n.use(initReactI18next).init({
  resources: {
${config.locales.map((l) => `    '${l}': { translation: ${varName(l)} },`).join('\n')}
  },
  lng: '${source}',
  fallbackLng: '${source}',
  interpolation: { escapeValue: false },
});

export default i18n;
`,
      };

    case 'vue-i18n':
      return {
        'src/i18n.ts': `import { createI18n } from 'vue-i18n';

${config.locales
  .map((l) => `import ${varName(l)} from './${path.posix.basename(config.messagesDir)}/${l}.json';`)
  .join('\n')}

export default createI18n({
  legacy: false,
  locale: '${source}',
  fallbackLocale: '${source}',
  messages: {
${config.locales.map((l) => `    '${l}': ${varName(l)},`).join('\n')}
  },
});
`,
      };

    case 'plain':
      return {
        'src/lib/i18n.ts': `/**
 * A translation function with no dependencies.
 *
 * Enough for a small app. If you outgrow it — plurals, dates, lazy-loaded
 * catalogues — move to a real runtime and re-run \`npx language-loop init\`.
 *
 * The JSON imports below assume a bundler (Vite, webpack, esbuild, Next). Under
 * raw Node ESM they need \`with { type: 'json' }\` and a module target of
 * nodenext or esnext.
 */
${config.locales.map((l) => `import ${varName(l)} from '../../${config.messagesDir}/${l}.json';`).join('\n')}

type Catalog = Record<string, unknown>;

const catalogs: Record<string, Catalog> = {
${config.locales.map((l) => `  '${l}': ${varName(l)},`).join('\n')}
};

export const locales = ${locales} as const;
export type Locale = (typeof locales)[number];

let current: string = '${source}';

export function setLocale(locale: string): void {
  current = locale in catalogs ? locale : '${source}';
}

export function getLocale(): string {
  return current;
}

export function t(key: string, values?: Record<string, string | number>): string {
  const raw = lookup(catalogs[current], key) ?? lookup(catalogs['${source}'], key) ?? key;
  if (!values) return raw;
  return raw.replace(/\\{(\\w+)\\}/g, (match, name) => String(values[name] ?? match));
}

function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  if (!catalog) return undefined;
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}
`,
      };

    default:
      return {};
  }
}

function varName(locale: string): string {
  return locale.replace(/[^a-zA-Z0-9]/g, '_');
}
