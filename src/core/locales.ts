/**
 * The language list offered at init, plus the facts about each locale that
 * change how a translation has to be written or reviewed.
 */

export interface LocaleInfo {
  code: string;
  name: string;
  english: string;
  /** Right-to-left script. The UI needs dir="rtl", not just words. */
  rtl: boolean;
  /** Roughly how much longer than English this language runs, in characters. */
  expansion: number;
  /** Languages where the T-V distinction forces a formality decision. */
  formalityMatters: boolean;
  /** CLDR plural categories in use. More than two means ICU plural is mandatory. */
  plurals: string[];
}

export const LOCALES: LocaleInfo[] = [
  { code: 'en', name: 'English', english: 'English', rtl: false, expansion: 1.0, formalityMatters: false, plurals: ['one', 'other'] },
  { code: 'de', name: 'Deutsch', english: 'German', rtl: false, expansion: 1.3, formalityMatters: true, plurals: ['one', 'other'] },
  { code: 'fr', name: 'Français', english: 'French', rtl: false, expansion: 1.25, formalityMatters: true, plurals: ['one', 'many', 'other'] },
  { code: 'es', name: 'Español', english: 'Spanish', rtl: false, expansion: 1.25, formalityMatters: true, plurals: ['one', 'many', 'other'] },
  { code: 'pt', name: 'Português', english: 'Portuguese', rtl: false, expansion: 1.25, formalityMatters: true, plurals: ['one', 'many', 'other'] },
  { code: 'pt-BR', name: 'Português (Brasil)', english: 'Portuguese (Brazil)', rtl: false, expansion: 1.25, formalityMatters: true, plurals: ['one', 'many', 'other'] },
  { code: 'it', name: 'Italiano', english: 'Italian', rtl: false, expansion: 1.2, formalityMatters: true, plurals: ['one', 'many', 'other'] },
  { code: 'nl', name: 'Nederlands', english: 'Dutch', rtl: false, expansion: 1.25, formalityMatters: true, plurals: ['one', 'other'] },
  { code: 'pl', name: 'Polski', english: 'Polish', rtl: false, expansion: 1.3, formalityMatters: true, plurals: ['one', 'few', 'many', 'other'] },
  { code: 'ru', name: 'Русский', english: 'Russian', rtl: false, expansion: 1.2, formalityMatters: true, plurals: ['one', 'few', 'many', 'other'] },
  { code: 'uk', name: 'Українська', english: 'Ukrainian', rtl: false, expansion: 1.2, formalityMatters: true, plurals: ['one', 'few', 'many', 'other'] },
  { code: 'cs', name: 'Čeština', english: 'Czech', rtl: false, expansion: 1.15, formalityMatters: true, plurals: ['one', 'few', 'many', 'other'] },
  { code: 'sv', name: 'Svenska', english: 'Swedish', rtl: false, expansion: 1.1, formalityMatters: false, plurals: ['one', 'other'] },
  { code: 'da', name: 'Dansk', english: 'Danish', rtl: false, expansion: 1.1, formalityMatters: false, plurals: ['one', 'other'] },
  { code: 'no', name: 'Norsk', english: 'Norwegian', rtl: false, expansion: 1.1, formalityMatters: false, plurals: ['one', 'other'] },
  { code: 'fi', name: 'Suomi', english: 'Finnish', rtl: false, expansion: 1.3, formalityMatters: false, plurals: ['one', 'other'] },
  { code: 'tr', name: 'Türkçe', english: 'Turkish', rtl: false, expansion: 1.1, formalityMatters: true, plurals: ['one', 'other'] },
  { code: 'ja', name: '日本語', english: 'Japanese', rtl: false, expansion: 0.6, formalityMatters: true, plurals: ['other'] },
  { code: 'ko', name: '한국어', english: 'Korean', rtl: false, expansion: 0.7, formalityMatters: true, plurals: ['other'] },
  { code: 'zh-CN', name: '简体中文', english: 'Chinese (Simplified)', rtl: false, expansion: 0.4, formalityMatters: false, plurals: ['other'] },
  { code: 'zh-TW', name: '繁體中文', english: 'Chinese (Traditional)', rtl: false, expansion: 0.4, formalityMatters: false, plurals: ['other'] },
  { code: 'ar', name: 'العربية', english: 'Arabic', rtl: true, expansion: 1.25, formalityMatters: false, plurals: ['zero', 'one', 'two', 'few', 'many', 'other'] },
  { code: 'he', name: 'עברית', english: 'Hebrew', rtl: true, expansion: 1.0, formalityMatters: false, plurals: ['one', 'two', 'many', 'other'] },
  { code: 'fa', name: 'فارسی', english: 'Persian', rtl: true, expansion: 1.2, formalityMatters: true, plurals: ['one', 'other'] },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', rtl: false, expansion: 1.2, formalityMatters: true, plurals: ['one', 'other'] },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', rtl: false, expansion: 1.2, formalityMatters: false, plurals: ['other'] },
  { code: 'th', name: 'ไทย', english: 'Thai', rtl: false, expansion: 1.0, formalityMatters: true, plurals: ['other'] },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese', rtl: false, expansion: 1.2, formalityMatters: true, plurals: ['other'] },
  { code: 'el', name: 'Ελληνικά', english: 'Greek', rtl: false, expansion: 1.2, formalityMatters: true, plurals: ['one', 'other'] },
  { code: 'ro', name: 'Română', english: 'Romanian', rtl: false, expansion: 1.25, formalityMatters: true, plurals: ['one', 'few', 'other'] },
  { code: 'hu', name: 'Magyar', english: 'Hungarian', rtl: false, expansion: 1.25, formalityMatters: true, plurals: ['one', 'other'] },
];

const BY_CODE = new Map(LOCALES.map((l) => [l.code.toLowerCase(), l]));

export function localeInfo(code: string): LocaleInfo {
  const hit = BY_CODE.get(code.toLowerCase());
  if (hit) return hit;
  // Fall back to the base language of a regional tag: pt-PT -> pt.
  const base = code.split('-')[0]!.toLowerCase();
  const baseHit = BY_CODE.get(base);
  if (baseHit) return { ...baseHit, code, name: code, english: code };
  return { code, name: code, english: code, rtl: false, expansion: 1.2, formalityMatters: false, plurals: ['one', 'other'] };
}

export function isRtl(code: string): boolean {
  return localeInfo(code).rtl;
}

/** The dozen most people actually pick, shown first at init. */
export const POPULAR = ['de', 'fr', 'es', 'pt-BR', 'it', 'nl', 'ja', 'zh-CN', 'ko', 'ar', 'pl', 'tr'];
