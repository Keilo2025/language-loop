import {
  POPULAR_LOCALE_CODES,
  REGIONS,
  REGION_LOCALE_CODES,
  TRANSLATION_GUIDANCE,
  type LocaleRegion,
} from './locale-catalog.js';

/**
 * The common audience locales offered during setup, plus the linguistic facts
 * that change how a translation has to be written or reviewed.
 */
export interface LocaleInfo {
  code: string;
  name: string;
  english: string;
  rtl: boolean;
  expansion: number;
  formalityMatters: boolean;
  plurals: string[];
}

export interface CommonLocale extends LocaleInfo {
  nativeName: string;
  regions: LocaleRegion[];
  tier: 'popular' | 'common';
  translationGuidance?: string;
}

export type { LocaleRegion };
export { REGIONS };

const RTL_LANGUAGES = new Set(['ar', 'ckb', 'fa', 'he', 'ps', 'ur']);
const FORMALITY_LANGUAGES = new Set([
  'af', 'ar', 'bg', 'ca', 'cs', 'de', 'el', 'es', 'fa', 'fr', 'hi', 'hr',
  'hu', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
  'th', 'tr', 'uk', 'vi', 'zh',
]);

const EXPANSION: Record<string, number> = {
  de: 1.3, fr: 1.25, es: 1.25, pt: 1.25, it: 1.2, nl: 1.25,
  pl: 1.3, ru: 1.2, uk: 1.2, cs: 1.15, sv: 1.1, da: 1.1,
  nb: 1.1, fi: 1.3, tr: 1.1, ja: 0.6, ko: 0.7, zh: 0.4,
  ar: 1.25, he: 1.0, fa: 1.2, hi: 1.2, id: 1.2, th: 1.0,
  vi: 1.2, el: 1.2, ro: 1.25, hu: 1.25,
};

const popular = new Set<string>(POPULAR_LOCALE_CODES);
const englishNames = new Intl.DisplayNames(['en'], { type: 'language' });

export function canonicalLocaleCode(code: string): string {
  try {
    const canonical = Intl.getCanonicalLocales(code.trim())[0];
    if (!canonical) throw new Error();
    return canonical;
  } catch {
    throw new Error(`Invalid locale code: ${code}`);
  }
}

function language(code: string): string {
  return new Intl.Locale(code).language;
}

function displayName(code: string, displayLocale: string): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function profile(code: string): Omit<LocaleInfo, 'code' | 'name' | 'english'> {
  const base = language(code);
  return {
    rtl: RTL_LANGUAGES.has(base),
    expansion: EXPANSION[base] ?? 1.2,
    formalityMatters: FORMALITY_LANGUAGES.has(base),
    plurals: [...new Intl.PluralRules(code).resolvedOptions().pluralCategories],
  };
}

const regionsByCode = new Map<string, LocaleRegion[]>();
for (const region of REGIONS) {
  for (const rawCode of REGION_LOCALE_CODES[region.code]) {
    const code = canonicalLocaleCode(rawCode);
    const regions = regionsByCode.get(code) ?? [];
    if (!regions.includes(region.code)) regions.push(region.code);
    regionsByCode.set(code, regions);
  }
}

export const COMMON_LOCALES: CommonLocale[] = [...regionsByCode].map(([code, regions]) => {
  const nativeName = displayName(code, code);
  return {
    code,
    name: nativeName,
    nativeName,
    english: englishNames.of(code) ?? code,
    regions,
    tier: popular.has(code) ? 'popular' as const : 'common' as const,
    translationGuidance: TRANSLATION_GUIDANCE[code],
    ...profile(code),
  };
}).sort((a, b) => {
  if (a.tier !== b.tier) return a.tier === 'popular' ? -1 : 1;
  return a.english.localeCompare(b.english) || a.code.localeCompare(b.code);
});

const BY_CODE = new Map(COMMON_LOCALES.map((locale) => [locale.code.toLowerCase(), locale]));

/** Backward-compatible name for programmatic consumers. */
export const LOCALES: LocaleInfo[] = COMMON_LOCALES;
export const POPULAR = COMMON_LOCALES.filter((locale) => locale.tier === 'popular').map((locale) => locale.code);

export function allCommonLocaleCodes(): string[] {
  return COMMON_LOCALES.map((locale) => locale.code);
}

export function localesForRegions(regions: LocaleRegion[]): CommonLocale[] {
  const selected = new Set(regions);
  return COMMON_LOCALES.filter((locale) => locale.regions.some((region) => selected.has(region)));
}

export function localeInfo(rawCode: string): LocaleInfo {
  let code: string;
  try {
    code = canonicalLocaleCode(rawCode);
  } catch {
    return {
      code: rawCode,
      name: rawCode,
      english: rawCode,
      rtl: false,
      expansion: 1.2,
      formalityMatters: false,
      plurals: ['one', 'other'],
    };
  }

  const exact = BY_CODE.get(code.toLowerCase());
  if (exact) return exact;

  const base = language(code);
  const baseProfile = COMMON_LOCALES.find((locale) => language(locale.code) === base);
  return {
    code,
    name: displayName(code, code),
    english: englishNames.of(code) ?? code,
    ...(baseProfile ? {
      rtl: baseProfile.rtl,
      expansion: baseProfile.expansion,
      formalityMatters: baseProfile.formalityMatters,
      plurals: [...new Intl.PluralRules(code).resolvedOptions().pluralCategories],
    } : profile(code)),
  };
}

export function isRtl(code: string): boolean {
  return localeInfo(code).rtl;
}
