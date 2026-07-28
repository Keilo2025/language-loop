import type { Config, GuardrailIssue, TranslationUnit } from '../types.js';
import { localeInfo } from './locales.js';
import { findPlaceholderOccurrences } from './scan.js';

/**
 * What must be true of a translation before a human is asked to look at it.
 *
 * A translation can be linguistically perfect and still break the app. A
 * dropped `{count}` is a runtime error; a swapped `<b>` is broken markup; a
 * German button three times the width of the English one is a broken layout.
 * These checks catch the failures that reviewers, reading a language they may
 * not speak, cannot be expected to catch by eye.
 */

const TIGHT_KINDS = new Set(['cta', 'label', 'nav', 'title']);

export function checkTranslations(units: TranslationUnit[], config: Config): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];

  for (const unit of units) {
    const { key, locale, source, value } = unit;
    const push = (rule: string, severity: 'block' | 'flag', message: string) =>
      issues.push({ key, locale, rule, severity, message });

    if (!value || !value.trim()) {
      push('empty', 'block', 'translation is empty');
      continue;
    }

    // 1. Placeholder parity. The single most common way a translation breaks a build.
    const wantPlaceholders = occurrenceCounts(findPlaceholderOccurrences(source));
    const gotPlaceholders = occurrenceCounts(findPlaceholderOccurrences(value));
    for (const [placeholder, wanted] of wantPlaceholders) {
      const got = gotPlaceholders.get(placeholder) ?? 0;
      if (got < wanted) {
        push(
          'placeholder-lost',
          'block',
          `source has ${wanted} occurrence(s) of ${placeholder}; translation has ${got}`
        );
      }
    }
    for (const [placeholder, got] of gotPlaceholders) {
      const wanted = wantPlaceholders.get(placeholder) ?? 0;
      if (got > wanted) {
        push(
          'placeholder-invented',
          'block',
          `translation has ${got} occurrence(s) of ${placeholder}; source has ${wanted}`
        );
      }
    }

    // 2. Markup integrity.
    if (!tagsBalanced(value)) push('markup-unbalanced', 'block', 'HTML tags in the translation do not close cleanly');

    // 3. ICU syntax. An unbalanced brace throws at render time, not build time.
    if (!bracesBalanced(value)) push('icu-unbalanced', 'block', 'unbalanced { } — ICU will fail to parse this');
    // The old form also required `!value.includes('{')`, which made the wrapping
    // test unreachable — a message with braces could never be flagged, which is
    // exactly the message this rule is for.
    if (/\b(plural|select|selectordinal)\s*,/.test(value) && !/\{[^{}]*,\s*(plural|select|selectordinal)\s*,/.test(value)) {
      push('icu-malformed', 'block', 'looks like an ICU message but the plural/select is not wrapped in braces');
    }
    const plurals = localeInfo(locale).plurals;
    if (/\bplural\s*,/.test(value)) {
      for (const category of plurals) {
        if (category === 'other') continue;
        // An explicit `=1{…}` covers the "one" category, but says nothing about
        // "few" or "many". Only exempt the category the exact match stands in for.
        if (new RegExp(`\\b${category}\\s*\\{`).test(value)) continue;
        if (category === 'one' && /=1\s*\{/.test(value)) continue;
        if (category === 'zero' && /=0\s*\{/.test(value)) continue;
        if (category === 'two' && /=2\s*\{/.test(value)) continue;
        push('plural-category-missing', 'flag', `${locale} uses the "${category}" plural category and this message does not cover it`);
      }
      if (!/\bother\s*\{/.test(value)) push('plural-other-missing', 'block', 'ICU plural without an "other" branch');
    }

    // 4. Terms that must not be translated.
    for (const term of config.voice.doNotTranslate) {
      if (source.includes(term) && !value.includes(term)) {
        push('brand-term-lost', 'block', `"${term}" must appear untranslated and does not`);
      }
    }

    // 5. Glossary.
    const glossary = config.voice.glossary ?? {};
    for (const [term, perLocale] of Object.entries(glossary)) {
      const required = perLocale[locale];
      if (!required) continue;
      if (source.toLowerCase().includes(term.toLowerCase()) && !value.toLowerCase().includes(required.toLowerCase())) {
        push('glossary', 'flag', `glossary says "${term}" is "${required}" in ${locale}; this translation uses something else`);
      }
    }

    // 6. Length, but only where length breaks something.
    if (TIGHT_KINDS.has(unit.kind)) {
      const expected = localeInfo(locale).expansion;
      const ratio = value.length / Math.max(1, source.length);
      if (ratio > Math.max(config.maxLengthRatio, expected * 1.5)) {
        push('too-long', 'flag', `${Math.round(ratio * 100)}% of the English length in a ${unit.kind} — likely to overflow its container`);
      }
    }

    // 7. Untouched source. Sometimes correct (proper nouns), usually a skipped item.
    if (value.trim() === source.trim() && source.split(/\s+/).length > 2) {
      push('untranslated', 'flag', 'identical to the source — check this was deliberate');
    }

    // 8. Leaked instructions. Models occasionally answer the brief instead of doing it.
    if (/^(here is|here's|sure,|translation:|i have translated)/i.test(value.trim())) {
      push('model-preamble', 'block', 'looks like a reply to the brief rather than a translation');
    }

    // 9. Whitespace the source did not have.
    if (/^\s|\s$/.test(value) && !/^\s|\s$/.test(source)) {
      push('whitespace', 'flag', 'leading or trailing whitespace the source does not have');
    }
  }

  return issues;
}

export function partition(units: TranslationUnit[], issues: GuardrailIssue[]): {
  kept: TranslationUnit[];
  blocked: { unit: TranslationUnit; issues: GuardrailIssue[] }[];
  flagged: Map<string, GuardrailIssue[]>;
} {
  const byUnit = new Map<string, GuardrailIssue[]>();
  for (const issue of issues) {
    const id = `${issue.key}::${issue.locale}`;
    if (!byUnit.has(id)) byUnit.set(id, []);
    byUnit.get(id)!.push(issue);
  }

  const kept: TranslationUnit[] = [];
  const blocked: { unit: TranslationUnit; issues: GuardrailIssue[] }[] = [];
  const flagged = new Map<string, GuardrailIssue[]>();

  for (const unit of units) {
    const id = `${unit.key}::${unit.locale}`;
    const unitIssues = byUnit.get(id) ?? [];
    if (unitIssues.length) {
      if (unitIssues.some((issue) => issue.severity === 'flag')) flagged.set(id, unitIssues);
      blocked.push({ unit, issues: unitIssues });
      continue;
    }
    kept.push(unit);
  }
  return { kept, blocked, flagged };
}

function occurrenceCounts(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function tagsBalanced(text: string): boolean {
  const stack: string[] = [];
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const closing = m[1] === '/';
    const name = m[2]!.toLowerCase();
    const selfClosing = m[3]!.trim().endsWith('/');
    if (selfClosing || ['br', 'hr', 'img', 'input'].includes(name)) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

function bracesBalanced(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '{') depth++;
    else if (char === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}
