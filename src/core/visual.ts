import fs from 'node:fs';
import path from 'node:path';
import { isRtl } from './locales.js';

export interface VisualViewport {
  name: string;
  width: number;
  height: number;
}

export interface VisualOverflow {
  selector: string;
  kind: 'document' | 'viewport' | 'clipped' | 'scroll';
  message: string;
}

export interface VisualInspection {
  documentDirection: string;
  htmlDir: string;
  htmlLang: string;
  overflow: VisualOverflow[];
  physicalDirectionRules: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

export interface VisualInspectionInput {
  url: string;
  locale: string;
  viewport: VisualViewport;
  screenshotPath: string;
  timeoutMs: number;
}

export interface VisualDriver {
  inspect(input: VisualInspectionInput): Promise<VisualInspection>;
  close(): Promise<void>;
}

export interface VisualCheckOptions {
  url: string;
  locales: string[];
  outDir: string;
  localeParam?: string;
  viewports?: VisualViewport[];
  timeoutMs?: number;
  /** Treat direction-specific CSS warnings as release-blocking findings. */
  strict?: boolean;
}

export interface VisualFinding {
  locale: string;
  viewport: string;
  rule:
    | 'horizontal-overflow'
    | 'rtl-direction'
    | 'html-lang'
    | 'physical-direction'
    | 'console-error'
    | 'page-error';
  severity: 'error' | 'warning';
  message: string;
  selector?: string;
}

export interface VisualCheck {
  locale: string;
  viewport: VisualViewport;
  url: string;
  screenshot: string;
  documentDirection: string;
  htmlDir: string;
  htmlLang: string;
  overflowCount: number;
}

export interface VisualReport {
  version: 1;
  ok: boolean;
  generatedAt: string;
  url: string;
  checks: VisualCheck[];
  findings: VisualFinding[];
}

export const DEFAULT_VISUAL_VIEWPORTS: VisualViewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

export function buildLocaleUrl(url: string, locale: string, localeParam = 'locale'): string {
  if (url.includes('{locale}')) {
    return url.replaceAll('{locale}', encodeURIComponent(locale));
  }
  const parsed = new URL(url);
  parsed.searchParams.set(localeParam, locale);
  return parsed.toString();
}

export async function runVisualChecks(
  options: VisualCheckOptions,
  driver: VisualDriver
): Promise<VisualReport> {
  if (!options.locales.length) throw new Error('Visual checks need at least one locale.');
  const viewports = options.viewports?.length ? options.viewports : DEFAULT_VISUAL_VIEWPORTS;
  const timeoutMs = options.timeoutMs ?? 30_000;
  fs.mkdirSync(options.outDir, { recursive: true });

  const checks: VisualCheck[] = [];
  const findings: VisualFinding[] = [];
  try {
    for (const locale of options.locales) {
      for (const viewport of viewports) {
        validateViewport(viewport);
        const screenshot = path.resolve(
          options.outDir,
          `${safeName(locale)}-${safeName(viewport.name)}-${viewport.width}x${viewport.height}.png`
        );
        const url = buildLocaleUrl(options.url, locale, options.localeParam);
        const result = await driver.inspect({
          url,
          locale,
          viewport,
          screenshotPath: screenshot,
          timeoutMs,
        });
        checks.push({
          locale,
          viewport,
          url,
          screenshot,
          documentDirection: result.documentDirection,
          htmlDir: result.htmlDir,
          htmlLang: result.htmlLang,
          overflowCount: result.overflow.length,
        });

        for (const overflow of result.overflow) {
          findings.push({
            locale,
            viewport: viewport.name,
            rule: 'horizontal-overflow',
            severity: 'error',
            message: overflow.message,
            selector: overflow.selector,
          });
        }
        if (isVisualRtl(locale) && (
          result.documentDirection.toLowerCase() !== 'rtl'
          || result.htmlDir.toLowerCase() !== 'rtl'
        )) {
          findings.push({
            locale,
            viewport: viewport.name,
            rule: 'rtl-direction',
            severity: 'error',
            message:
              'Expected <html dir="rtl"> and computed direction "rtl"; received ' +
              `dir="${result.htmlDir || 'unset'}", computed "${result.documentDirection || 'unset'}".`,
          });
        }
        if (result.htmlLang.toLowerCase() !== locale.toLowerCase()) {
          findings.push({
            locale,
            viewport: viewport.name,
            rule: 'html-lang',
            severity: 'error',
            message: `Expected <html lang="${locale}">, received "${result.htmlLang || 'unset'}".`,
          });
        }
        for (const rule of result.physicalDirectionRules) {
          findings.push({
            locale,
            viewport: viewport.name,
            rule: 'physical-direction',
            severity: 'warning',
            message: `Direction-specific CSS may not mirror in RTL: ${rule}`,
          });
        }
        for (const error of result.consoleErrors) {
          findings.push({
            locale,
            viewport: viewport.name,
            rule: 'console-error',
            severity: 'error',
            message: error,
          });
        }
        for (const error of result.pageErrors) {
          findings.push({
            locale,
            viewport: viewport.name,
            rule: 'page-error',
            severity: 'error',
            message: error,
          });
        }
      }
    }
  } finally {
    await driver.close();
  }

  return {
    version: 1,
    ok: !findings.some((finding) =>
      finding.severity === 'error' || Boolean(options.strict)
    ),
    generatedAt: new Date().toISOString(),
    url: options.url,
    checks,
    findings,
  };
}

export async function createPlaywrightVisualDriver(): Promise<VisualDriver> {
  type ConsoleMessage = { type(): string; text(): string };
  type BrowserPage = {
    on(event: 'console', listener: (message: ConsoleMessage) => void): void;
    on(event: 'pageerror', listener: (error: Error) => void): void;
    goto(url: string, options: Record<string, unknown>): Promise<unknown>;
    screenshot(options: Record<string, unknown>): Promise<unknown>;
    evaluate(expression: string): Promise<unknown>;
    close(): Promise<void>;
  };
  type Browser = {
    newPage(options: Record<string, unknown>): Promise<BrowserPage>;
    close(): Promise<void>;
  };
  type PlaywrightModule = {
    chromium: { launch(options: Record<string, unknown>): Promise<Browser> };
  };

  const dynamicImport = new Function(
    'specifier',
    'return import(specifier)'
  ) as (specifier: string) => Promise<unknown>;
  let module: PlaywrightModule;
  try {
    module = await dynamicImport('playwright') as PlaywrightModule;
  } catch {
    throw new Error(
      'Browser validation needs Playwright.\n' +
      'Install it in the project with  npm install --save-dev playwright  ' +
      'and then run  npx playwright install chromium.'
    );
  }
  if (!module.chromium?.launch) {
    throw new Error('The installed Playwright package does not expose Chromium.');
  }
  const browser = await module.chromium.launch({ headless: true });

  return {
    async inspect(input): Promise<VisualInspection> {
      const page = await browser.newPage({
        viewport: { width: input.viewport.width, height: input.viewport.height },
      });
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));

      try {
        await page.goto(input.url, {
          waitUntil: 'networkidle',
          timeout: input.timeoutMs,
        });
        const raw = await page.evaluate(browserInspectionScript());
        await page.screenshot({ path: input.screenshotPath, fullPage: true });
        return normalizeInspection(raw, consoleErrors, pageErrors);
      } finally {
        await page.close();
      }
    },
    async close(): Promise<void> {
      await browser.close();
    },
  };
}

function browserInspectionScript(): string {
  // A string keeps the shipping package independent of DOM TypeScript types;
  // this function runs inside Chromium, not Node.
  return String.raw`(() => {
    const overflow = [];
    const root = document.documentElement;
    const tolerance = 1;
    const selectorFor = (element) => {
      if (element.id) return '#' + CSS.escape(element.id);
      const classes = Array.from(element.classList || []).slice(0, 2)
        .map((name) => '.' + CSS.escape(name)).join('');
      return element.tagName.toLowerCase() + classes;
    };
    if (root.scrollWidth > root.clientWidth + tolerance) {
      overflow.push({
        selector: 'html',
        kind: 'document',
        message: 'document is ' + (root.scrollWidth - root.clientWidth) + 'px wider than the viewport',
      });
    }
    for (const element of Array.from(document.body?.querySelectorAll('*') || [])) {
      if (overflow.length >= 100) break;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && (rect.left < -tolerance || rect.right > innerWidth + tolerance)) {
        overflow.push({
          selector: selectorFor(element),
          kind: 'viewport',
          message: 'element extends beyond the horizontal viewport (' +
            Math.round(rect.left) + '..' + Math.round(rect.right) + 'px)',
        });
        continue;
      }
      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      if (
        (clipsX && element.scrollWidth > element.clientWidth + tolerance) ||
        (clipsY && element.scrollHeight > element.clientHeight + tolerance)
      ) {
        overflow.push({
          selector: selectorFor(element),
          kind: 'clipped',
          message: 'content is clipped by its element bounds',
        });
      } else if (element.scrollWidth > element.clientWidth + tolerance) {
        overflow.push({
          selector: selectorFor(element),
          kind: 'scroll',
          message: 'element has ' + (element.scrollWidth - element.clientWidth) +
            'px of horizontal scroll overflow',
        });
      }
    }

    const physicalDirectionRules = [];
    const physicalPattern = /(?:^|[;{])\s*(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/i;
    const inspectRules = (rules) => {
      for (const rule of Array.from(rules || [])) {
        const cssText = String(rule.cssText || '');
        if (physicalPattern.test(cssText) && physicalDirectionRules.length < 50) {
          physicalDirectionRules.push(cssText.slice(0, 240));
        }
        if (rule.cssRules) inspectRules(rule.cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets || [])) {
      try { inspectRules(sheet.cssRules); } catch { /* cross-origin stylesheet */ }
    }

    return {
      documentDirection: getComputedStyle(root).direction || root.dir || '',
      htmlDir: root.dir || '',
      htmlLang: root.lang || '',
      overflow,
      physicalDirectionRules,
    };
  })()`;
}

function normalizeInspection(
  raw: unknown,
  consoleErrors: string[],
  pageErrors: string[]
): VisualInspection {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Browser inspection returned an invalid result.');
  }
  const result = raw as Record<string, unknown>;
  return {
    documentDirection: typeof result.documentDirection === 'string' ? result.documentDirection : '',
    htmlDir: typeof result.htmlDir === 'string' ? result.htmlDir : '',
    htmlLang: typeof result.htmlLang === 'string' ? result.htmlLang : '',
    overflow: Array.isArray(result.overflow)
      ? result.overflow.filter(isVisualOverflow)
      : [],
    physicalDirectionRules: stringArray(result.physicalDirectionRules),
    consoleErrors,
    pageErrors,
  };
}

function isVisualOverflow(value: unknown): value is VisualOverflow {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.selector === 'string'
    && typeof item.message === 'string'
    && (
      item.kind === 'document'
      || item.kind === 'viewport'
      || item.kind === 'clipped'
      || item.kind === 'scroll'
    );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isVisualRtl(locale: string): boolean {
  return locale.toLowerCase() === 'ar-xb' || isRtl(locale);
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function validateViewport(viewport: VisualViewport): void {
  if (!viewport.name || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error(`Invalid visual viewport: ${JSON.stringify(viewport)}.`);
  }
}
