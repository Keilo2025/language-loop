import type { Flat } from './catalog.js';

export type PseudoLocale = 'en-XA' | 'ar-XB';

interface MessagePart {
  protected: boolean;
  value: string;
}

const ACCENTS: Record<string, string> = {
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'Ë', F: 'Ƒ', G: 'Ĝ', H: 'Ḩ', I: 'Ï',
  J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ḿ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ',
  S: 'Š', T: 'Ţ', U: 'Ü', V: 'Ṽ', W: 'Ŵ', X: 'Ẍ', Y: 'Ÿ', Z: 'Ž',
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'ë', f: 'ƒ', g: 'ĝ', h: 'ḩ', i: 'ï',
  j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ḿ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ',
  s: 'š', t: 'ţ', u: 'ü', v: 'ṽ', w: 'ŵ', x: 'ẍ', y: 'ÿ', z: 'ž',
};

const MIRRORED_PUNCTUATION: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
};

/**
 * Produce a layout-stressing pseudo translation while preserving runtime
 * message syntax. en-XA expands/accentuates copy; ar-XB mirrors visible copy
 * inside an explicit right-to-left isolate.
 */
export function pseudolocalize(message: string, locale: PseudoLocale): string {
  if (locale !== 'en-XA' && locale !== 'ar-XB') {
    throw new Error(`Unsupported pseudo-locale "${locale}". Use en-XA or ar-XB.`);
  }

  const parts = tokenizeMessage(message);
  const transformed = parts.map((part) => {
    if (part.protected) return part.value;
    return locale === 'en-XA'
      ? accentVisible(part.value)
      : mirrorVisible(part.value);
  }).join('');

  const targetLength = Math.ceil(message.length * 1.3);
  const wrapperLength = locale === 'en-XA' ? 8 : 2;
  const paddingLength = Math.max(0, targetLength - transformed.length - wrapperLength);

  if (locale === 'en-XA') {
    return `[!! ${transformed}${'·'.repeat(paddingLength)} !!]`;
  }
  return `\u2067${transformed}${'ـ'.repeat(paddingLength)}\u2069`;
}

export function pseudoCatalog(source: Flat, locale: PseudoLocale): Flat {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, pseudolocalize(value, locale)])
  );
}

/** Exposed for regression tests and integrations that want to verify parity. */
export function protectedMessageTokens(message: string): string[] {
  return tokenizeMessage(message)
    .filter((part) => part.protected)
    .map((part) => part.value);
}

function accentVisible(value: string): string {
  return Array.from(value, (character) => ACCENTS[character] ?? character).join('');
}

function mirrorVisible(value: string): string {
  // Keep line boundaries stable so screenshots point to the same structural
  // break as the source catalogue.
  return value.split(/(\r?\n)/).map((line) => {
    if (/^\r?\n$/.test(line)) return line;
    return Array.from(line)
      .reverse()
      .map((character) => MIRRORED_PUNCTUATION[character] ?? character)
      .join('');
  }).join('');
}

function tokenizeMessage(message: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let visibleStart = 0;
  let cursor = 0;

  const pushProtected = (end: number) => {
    if (cursor > visibleStart) {
      parts.push({ protected: false, value: message.slice(visibleStart, cursor) });
    }
    parts.push({ protected: true, value: message.slice(cursor, end) });
    cursor = end;
    visibleStart = end;
  };

  while (cursor < message.length) {
    let end = -1;

    if (message[cursor] === '<') {
      end = tagEnd(message, cursor);
    } else if (message.startsWith('{{', cursor)) {
      const close = message.indexOf('}}', cursor + 2);
      if (close !== -1) end = close + 2;
    } else if (message[cursor] === '{') {
      end = balancedBraceEnd(message, cursor);
    } else if (message[cursor] === '\\' && cursor + 1 < message.length) {
      end = escapeEnd(message, cursor);
    } else if (message[cursor] === '%') {
      const match = message.slice(cursor).match(
        /^%(?:\d+\$)?[-+#0 ']*(?:\d+|\*)?(?:\.(?:\d+|\*))?[a-zA-Z%]/
      );
      if (match) end = cursor + match[0].length;
    } else if (message[cursor] === '&') {
      const match = message.slice(cursor).match(/^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i);
      if (match) end = cursor + match[0].length;
    }

    if (end > cursor) {
      pushProtected(end);
      continue;
    }
    cursor++;
  }

  if (visibleStart < message.length) {
    parts.push({ protected: false, value: message.slice(visibleStart) });
  }
  return parts;
}

function tagEnd(message: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start + 1; index < message.length; index++) {
    const character = message[index]!;
    if (quote) {
      if (character === quote && message[index - 1] !== '\\') quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
}

function balancedBraceEnd(message: string, start: number): number {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < message.length; index++) {
    const character = message[index]!;
    if (character === "'") {
      if (message[index + 1] === "'") {
        index++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === '{') depth++;
    if (character === '}') {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function escapeEnd(message: string, start: number): number {
  if (message[start + 1] === 'u') {
    const unicode = message.slice(start).match(/^\\u(?:\{[\da-f]+\}|[\da-f]{4})/i);
    if (unicode) return start + unicode[0].length;
  }
  if (message[start + 1] === 'x') {
    const hexadecimal = message.slice(start).match(/^\\x[\da-f]{2}/i);
    if (hexadecimal) return start + hexadecimal[0].length;
  }
  return start + 2;
}
