import fs from 'node:fs';
import path from 'node:path';
import type { Config, ScannedString, StringKind } from '../types.js';
import { posix, walk } from './util.js';

/**
 * Find the words a user can actually read.
 *
 * No AST. Vibe-coded repos do not always parse, and a parser that throws on
 * one file gives you nothing for the other four hundred. Regexes degrade
 * gracefully; a missed string costs a second pass, a wrongly-rewritten string
 * costs a broken build. So this is tuned to be quiet rather than complete.
 */

const TEXT_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs', '.vue', '.svelte', '.astro', '.html']);

/** Attributes whose value a human reads on screen. */
const UI_ATTRS = new Set([
  'placeholder', 'title', 'alt', 'aria-label', 'arialabel', 'aria-description',
  'label', 'description', 'tooltip', 'subtitle', 'heading', 'caption', 'hint',
  'confirmtext', 'canceltext', 'submitlabel', 'emptymessage', 'errormessage',
]);

/** Object keys that, in a config-driven UI, hold copy rather than configuration. */
const UI_KEYS = new Set([
  'title', 'label', 'heading', 'subtitle', 'description', 'message', 'placeholder',
  'cta', 'ctaLabel', 'buttonText', 'error', 'errorMessage', 'emptyState', 'hint',
  'tooltip', 'caption', 'summary', 'body', 'text', 'name',
]);

/** Never treat these as copy, wherever they appear. */
const TECH_WORDS = new Set([
  'true', 'false', 'null', 'undefined', 'div', 'span', 'button', 'submit', 'reset',
  'primary', 'secondary', 'default', 'small', 'medium', 'large', 'sm', 'md', 'lg', 'xl',
  'left', 'right', 'center', 'top', 'bottom', 'row', 'column', 'flex', 'grid', 'none',
  'get', 'post', 'put', 'patch', 'delete', 'json', 'text', 'html', 'utf-8', 'auto',
  'button', 'checkbox', 'radio', 'email', 'password', 'number', 'date', 'time', 'url',
  'light', 'dark', 'system', 'outline', 'ghost', 'link', 'icon', 'lazy', 'eager', 'sync',
]);

export interface ScanResult {
  strings: ScannedString[];
  filesScanned: number;
  /** Files that already use a translation call — evidence the wiring works. */
  filesAlreadyTranslated: number;
}

export function scanRepo(cwd: string, config: Config): ScanResult {
  const files = walk(cwd, {
    include: config.include,
    exclude: [...config.exclude, `${config.messagesDir}/**`],
    extensions: [...TEXT_EXT],
  });

  const strings: ScannedString[] = [];
  let filesAlreadyTranslated = 0;

  for (const rel of files) {
    if (config.protectedFiles.includes(rel)) continue;
    let content: string;
    try {
      content = fs.readFileSync(path.join(cwd, rel), 'utf8');
    } catch {
      continue;
    }
    if (content.length > 400_000) continue;
    if (/\buseTranslations?\s*\(|\bi18n\b|\$t\s*\(/.test(content)) filesAlreadyTranslated++;

    const ext = path.extname(rel);
    if (ext === '.vue') strings.push(...scanVue(rel, content, config));
    else if (ext === '.svelte' || ext === '.astro') strings.push(...scanMarkupish(rel, content, config));
    else if (ext === '.html') strings.push(...scanMarkupish(rel, content, config));
    else strings.push(...scanJs(rel, content, config));
  }

  return { strings: dedupe(strings), filesScanned: files.length, filesAlreadyTranslated };
}

/**
 * Which keys the code still calls for.
 *
 * `scanRepo` only sees strings that are *still hardcoded*, so it says nothing
 * about a key that was extracted last month — that string is now `t('…')` and
 * invisible to it. Without this, memory can never tell "deleted from the app"
 * from "already done", so dead keys are re-translated forever and `--prune` has
 * nothing to prune.
 */
export function scanKeyUsage(cwd: string, config: Config): Set<string> {
  const files = walk(cwd, {
    include: config.include,
    exclude: [...config.exclude, `${config.messagesDir}/**`],
    extensions: [...TEXT_EXT],
  });

  const used = new Set<string>();
  for (const rel of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(cwd, rel), 'utf8');
    } catch {
      continue;
    }
    if (content.length > 400_000) continue;

    // t('key'), $t("key"), i18n.t(`key`), intl.formatMessage({ id: 'key' })
    for (const m of content.matchAll(/\b\$?t\s*\(\s*(["'`])([^"'`]+)\1/g)) used.add(m[2]!);
    for (const m of content.matchAll(/\bid\s*:\s*(["'`])([^"'`]+)\1/g)) used.add(m[2]!);
    // paraglide compiles keys to identifiers: m.common_ship_it()
    for (const m of content.matchAll(/\bm\.([A-Za-z_$][\w$]*)\s*\(/g)) used.add(m[1]!);
  }
  return used;
}

// ---------------------------------------------------------------------------
// Per-syntax scanners
// ---------------------------------------------------------------------------

function scanJs(file: string, content: string, config: Config): ScannedString[] {
  const out: ScannedString[] = [];
  const stripped = blankOutComments(content);

  // 1. JSX text nodes: >Ship it in an afternoon<
  //    Also catches interpolated text — >You have {count} builds waiting.< —
  //    because a sentence with a value in the middle is exactly the sentence
  //    that breaks when someone translates it word by word.
  const textRe = />([^<>]+)</g;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(stripped))) {
    const raw = m[1]!;
    const text = raw.trim();
    if (!isJsxTextCandidate(text)) continue;
    if (!isCopy(stripLiteralBraces(text), 'jsx-text', config)) continue;
    // A `=>` arrow leaves a bogus ">" — the char before must close a tag.
    if (stripped[m.index - 1] === '=') continue;
    out.push({
      file,
      // The `>` and the words can sit on different lines. Report where the
      // words are — that is the line the extractor rewrites and the line a
      // human opens.
      line: lineAt(stripped, m.index + 1 + leadingWhitespace(raw)),
      text,
      raw,
      kind: kindFromTag(precedingTag(stripped, m.index), text),
      context: 'jsx-text',
      component: enclosingComponent(stripped, m.index),
      placeholders: findPlaceholders(text),
    });
  }

  // 2. JSX attributes: placeholder="you@example.com"
  const attrRe = /\b([a-zA-Z-]+)\s*=\s*(["'])((?:(?!\2)[^\\]|\\.)*)\2/g;
  while ((m = attrRe.exec(stripped))) {
    const attr = m[1]!.toLowerCase();
    if (!UI_ATTRS.has(attr)) continue;
    const text = unescape(m[3]!).trim();
    if (!isCopy(text, 'jsx-attr', config)) continue;
    out.push({
      file,
      line: lineAt(stripped, m.index),
      text,
      raw: m[0]!,
      attr: m[1]!,
      kind: kindFromAttr(attr),
      context: 'jsx-attr',
      component: enclosingComponent(stripped, m.index),
      placeholders: findPlaceholders(text),
    });
  }

  // 3. Object literals that hold copy: { title: 'Pricing', description: '...' }
  const objRe = /\b([a-zA-Z_]\w*)\s*:\s*(["'`])((?:(?!\2)[^\\]|\\.)*)\2/g;
  while ((m = objRe.exec(stripped))) {
    const key = m[1]!;
    if (!UI_KEYS.has(key)) continue;
    const text = unescape(m[3]!).trim();
    if (!isCopy(text, 'literal', config)) continue;
    if (isInsideTranslationCall(stripped, m.index)) continue;
    out.push({
      file,
      line: lineAt(stripped, m.index),
      text,
      raw: m[0]!,
      attr: key,
      kind: kindFromAttr(key.toLowerCase()),
      context: 'literal',
      component: enclosingComponent(stripped, m.index),
      scope: functionDepth(stripped, m.index) === 0 ? 'module' : 'nested',
      placeholders: findPlaceholders(text),
    });
  }

  return out;
}

function scanVue(file: string, content: string, config: Config): ScannedString[] {
  const template = /<template[^>]*>([\s\S]*?)<\/template>/i.exec(content);
  const out: ScannedString[] = [];
  if (template) {
    const offset = template.index + template[0].indexOf(template[1]!);
    out.push(...scanMarkup(file, template[1]!, config, content, offset, 'vue'));
  }
  const script = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(content);
  if (script) {
    for (const s of scanJs(file, script[1]!, config)) {
      if (s.context === 'literal') out.push({ ...s, line: s.line + lineAt(content, script.index) - 1 });
    }
  }
  return out;
}

function scanMarkupish(file: string, content: string, config: Config): ScannedString[] {
  // Svelte and Astro both put script blocks alongside markup; blank the scripts
  // so template text is not confused with code.
  const blanked = content.replace(/<script[\s\S]*?<\/script>/gi, (s) => ' '.repeat(s.length))
    .replace(/<style[\s\S]*?<\/style>/gi, (s) => ' '.repeat(s.length))
    .replace(/^---[\s\S]*?---/, (s) => ' '.repeat(s.length));
  return scanMarkup(file, blanked, config, content, 0, 'html');
}

function scanMarkup(
  file: string,
  markup: string,
  config: Config,
  fullContent: string,
  offset: number,
  flavour: 'vue' | 'html'
): ScannedString[] {
  const out: ScannedString[] = [];
  const textCtx = flavour === 'vue' ? 'vue-text' : 'html-text';
  const attrCtx = flavour === 'vue' ? 'vue-attr' : 'html-attr';

  const textRe = />([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(markup))) {
    const text = m[1]!.trim();
    if (!isCopy(text, 'jsx-text', config)) continue;
    const tag = precedingTag(markup, m.index);
    if (tag === 'script' || tag === 'style') continue;
    out.push({
      file,
      line: lineAt(fullContent, offset + m.index + 1 + leadingWhitespace(m[1]!)),
      text,
      raw: m[1]!,
      kind: kindFromTag(tag, text),
      context: textCtx,
      placeholders: findPlaceholders(text),
    });
  }

  const attrRe = /\b([a-zA-Z-]+)\s*=\s*(["'])((?:(?!\2)[^\\]|\\.)*)\2/g;
  while ((m = attrRe.exec(markup))) {
    const attr = m[1]!.toLowerCase();
    if (!UI_ATTRS.has(attr)) continue;
    const text = unescape(m[3]!).trim();
    if (!isCopy(text, 'jsx-attr', config)) continue;
    out.push({
      file,
      line: lineAt(fullContent, offset + m.index),
      text,
      raw: m[0]!,
      attr: m[1]!,
      kind: kindFromAttr(attr),
      context: attrCtx,
      placeholders: findPlaceholders(text),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The filter that decides what counts as copy
// ---------------------------------------------------------------------------

export function isCopy(text: string, context: ScannedString['context'], config: Config): boolean {
  if (!text) return false;
  if (text.length < 2 || text.length > 600) return false;
  if (!/[A-Za-z\u00C0-\u024F\u0370-\u1FFF\u3040-\u9FFF]/.test(text)) return false;
  if (config.ignoreStrings.some((p) => text.includes(p))) return false;

  // Anything that is plainly an address, a token or a format string.
  if (/^(https?:|mailto:|tel:|data:|\/|\.\/|\.\.\/|#|@|\$\{)/.test(text)) return false;
  if (/^[A-Z0-9_]{2,}$/.test(text)) return false;                    // SCREAMING_CONSTANT
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(text)) return false;           // kebab-case
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(text)) return false;          // camelCase
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(text)) return false;           // snake_case
  if (/^#?[0-9a-fA-F]{3,8}$/.test(text)) return false;               // colours
  if (/^\d+(\.\d+)*(px|rem|em|%|s|ms|vh|vw)?$/.test(text)) return false;
  if (/^[\w.-]+\.(js|ts|tsx|jsx|css|json|png|jpg|svg|webp|ico|woff2?)$/i.test(text)) return false;
  if (/^[A-Z][a-zA-Z0-9]*$/.test(text) && text.length <= 2) return false;

  const words = text.split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  if (TECH_WORDS.has(lower)) return false;

  // Tailwind and other class soup: many short tokens, no sentence shape.
  if (words.length >= 3 && words.every((w) => /^[a-z0-9:[\]./_-]+$/.test(w))) return false;

  if (words.length === 1) {
    // A lone word is copy only if it reads like one: capitalised, or long
    // enough and vowelled enough to be a real word rather than an identifier.
    const capitalised = /^[A-Z\u00C0-\u024F]/.test(text);
    const wordish = text.length >= 4 && /[aeiouAEIOU]/.test(text) && /^[A-Za-z\u00C0-\u024F'’-]+$/.test(text);
    if (!capitalised && !wordish) return false;
    // Single lowercase words in attributes are almost always enum values.
    if (context === 'jsx-attr' && !capitalised) return false;
    if (context === 'literal' && !capitalised) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Replace comment bodies with spaces so offsets and line numbers stay true. */
export function blankOutComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (s, p1) => p1 + ' '.repeat(s.length - p1.length));
}

function leadingWhitespace(text: string): number {
  return text.length - text.trimStart().length;
}

export function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') line++;
  return line;
}

/** The tag that opens the text node at `index`, e.g. "h1" or "button". */
export function precedingTag(content: string, index: number): string {
  const start = Math.max(0, index - 400);
  const slice = content.slice(start, index + 1);
  const open = slice.lastIndexOf('<');
  if (open === -1) return '';
  const m = /^<\/?([A-Za-z][\w.-]*)/.exec(slice.slice(open));
  return m ? m[1]!.toLowerCase() : '';
}

export function enclosingComponent(content: string, index: number): string | undefined {
  const slice = content.slice(0, index);
  const re = /(?:export\s+default\s+function|export\s+function|function|const)\s+([A-Z][A-Za-z0-9_]*)/g;
  let last: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice))) last = m[1];
  return last;
}

/**
 * How many *function bodies* are open at this offset.
 *
 * Not the same as brace depth: `const plans = [{ title: 'Solo' }]` at module
 * scope is two braces deep and still nowhere a hook can be called. The
 * distinction decides whether rewriting a string produces working code or an
 * import-time crash, so it is worth the extra bookkeeping.
 *
 * A `{` opens a function body when the token before it is `)` — the end of a
 * parameter list — or `=>`. Everything else is an object literal, a JSX
 * expression or a class body.
 */
export function functionDepth(content: string, index: number): number {
  const stack: boolean[] = [];
  let quote: string | null = null;

  for (let i = 0; i < index && i < content.length; i++) {
    const char = content[i]!;
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(content[j]!)) j--;
      const prev = content[j];
      const prevPrev = j > 0 ? content[j - 1] : '';
      stack.push(prev === ')' || (prev === '>' && prevPrev === '='));
      continue;
    }
    if (char === '}') stack.pop();
  }
  return stack.filter(Boolean).length;
}

function isInsideTranslationCall(content: string, index: number): boolean {
  const before = content.slice(Math.max(0, index - 40), index);
  return /\b\$?t\s*\(\s*$|i18n\.[a-z]+\(\s*$|useTranslations?\(\s*$/.test(before);
}

/**
 * Is this JSX text node a sentence, or is it code that happened to sit between
 * two angle brackets?
 *
 * The distinction has to be made without parsing. A sentence may contain
 * `{value}` interpolations; it may not contain calls, arrows, ternaries or
 * anything else with executable shape.
 */
export function isJsxTextCandidate(text: string): boolean {
  if (!text) return false;
  if (!text.includes('{')) return true;
  if (/[()=;`?:]|\.\.\./.test(text.replace(/\{[^{}]*\}/g, ''))) return false;

  let depth = 0;
  for (const char of text) {
    if (char === '{') depth++;
    else if (char === '}') depth--;
    if (depth < 0 || depth > 1) return false;
  }
  if (depth !== 0) return false;

  const groups = [...text.matchAll(/\{([^{}]*)\}/g)];
  // Every interpolation must be a plain value read: {count}, {user.name}.
  if (!groups.every((g) => /^\s*[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*\s*$/.test(g[1]!))) return false;
  // A node that is only an interpolation carries no words of its own.
  return stripLiteralBraces(text).trim().length > 0;
}

function stripLiteralBraces(text: string): string {
  return text.replace(/\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
}

export function findPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const re of [/\{\{[^}]+\}\}/g, /\{[^{}]+\}/g, /%[sd@]/g, /%\d+\$[sd@]/g, /<\/?[a-zA-Z][\w-]*>/g]) {
    for (const m of text.matchAll(re)) found.add(m[0]);
  }
  return [...found];
}

function kindFromAttr(attr: string): StringKind {
  if (attr === 'placeholder') return 'placeholder';
  if (attr === 'alt') return 'alt';
  if (attr === 'title') return 'title';
  if (attr.startsWith('aria')) return 'aria';
  if (attr.includes('error')) return 'error';
  if (attr.includes('empty')) return 'empty-state';
  if (attr === 'label' || attr.includes('label')) return 'label';
  if (attr === 'heading' || attr === 'subtitle') return 'heading';
  if (attr === 'cta' || attr.includes('button')) return 'cta';
  if (attr === 'description' || attr === 'summary' || attr === 'body') return 'body';
  return 'unknown';
}

function kindFromTag(tag: string, text: string): StringKind {
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'button') return 'cta';
  if (tag === 'label') return 'label';
  if (tag === 'title') return 'meta';
  if (tag === 'a') return 'nav';
  if (tag === 'li') return 'nav';
  // Only the shapes an error message actually takes. "…the moment one fails"
  // is a feature description, not an error, and mislabelling it sends the
  // translator the wrong instruction about tone.
  if (/^(error|sorry|oops|something went wrong)\b/i.test(text)) return 'error';
  if (/\b(went wrong|could not be|failed to|is invalid|was denied|is required|try again)\b/i.test(text)) return 'error';
  if (/^(no |nothing |you have no |there are no |you do not have any )/i.test(text)) return 'empty-state';
  if (text.length <= 24 && !/[.!?]$/.test(text)) return 'label';
  return 'body';
}

function unescape(text: string): string {
  return text.replace(/\\(["'\\nrt])/g, (_, c) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c
  );
}

function dedupe(items: ScannedString[]): ScannedString[] {
  const seen = new Set<string>();
  const out: ScannedString[] = [];
  for (const s of items) {
    const id = `${s.file}:${s.line}:${s.context}:${s.attr ?? ''}:${s.text}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}
