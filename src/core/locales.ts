import {
  COUNTRY_REGION,
  DIALECT_RULE,
  EXTENDED_LANGUAGE_CODES,
  POPULAR_LOCALE_CODES,
  REGIONS,
  REGION_LOCALE_CODES,
  TRANSLATION_GUIDANCE,
  type LocaleRegion,
} from './locale-catalog.js';

export { DIALECT_RULE };

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
  translationGuidance?: string;
}

export interface CommonLocale extends LocaleInfo {
  nativeName: string;
  regions: LocaleRegion[];
  /**
   * `popular` and `common` are audience locales with a country attached —
   * pt-BR, not pt. `extended` is the long tail of languages ICU knows about,
   * offered so the picker can honestly claim to list every written language.
   */
  tier: 'popular' | 'common' | 'extended';
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

/**
 * Where ICU thinks a language is mainly spoken. `sw` maximises to `sw-Latn-TZ`,
 * which lands in Africa. This is what lets region selection cover the long tail
 * without anybody maintaining a list of 180 languages by hand.
 */
function regionsFor(code: string): LocaleRegion[] {
  const explicit = regionsByCode.get(code);
  if (explicit) return explicit;
  try {
    const country = new Intl.Locale(code).maximize().region;
    const region = country ? COUNTRY_REGION[country] : undefined;
    return region ? [region] : [];
  } catch {
    return [];
  }
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const scriptNames = new Intl.DisplayNames(['en'], { type: 'script' });

/**
 * A regional tag is a promise that the copy will sound local. Say so explicitly
 * for every one of them, not just the dozen with a hand-written note.
 */
function guidanceFor(code: string): string | undefined {
  const explicit = TRANSLATION_GUIDANCE[code];
  if (explicit) return explicit;

  let parsed: Intl.Locale;
  try {
    parsed = new Intl.Locale(code);
  } catch {
    return undefined;
  }
  const country = parsed.region;
  if (!country) return undefined;

  // The bare language name, not the locale's — "Spanish of Chile", never
  // "Spanish (Chile) of Chile".
  const language = englishNames.of(parsed.language) ?? parsed.language;
  const where = (() => {
    try {
      return regionNames.of(country) ?? country;
    } catch {
      return country;
    }
  })();
  const script = parsed.script ? `, in ${scriptNames.of(parsed.script) ?? parsed.script} script` : '';

  return `Use the everyday ${language} of ${where}${script} — the wording a native speaker there would actually use, not a neutral or textbook variety.`;
}

function entry(code: string, tier: CommonLocale['tier']): CommonLocale {
  const nativeName = displayName(code, code);
  const english = englishNames.of(code) ?? code;
  return {
    code,
    name: nativeName,
    nativeName,
    english,
    regions: regionsFor(code),
    tier,
    translationGuidance: guidanceFor(code),
    ...profile(code),
  };
}

const curated: CommonLocale[] = [...regionsByCode].map(([code]) =>
  entry(code, popular.has(code) ? 'popular' : 'common')
);

const seen = new Set(curated.map((locale) => locale.code.toLowerCase()));

const extended: CommonLocale[] = EXTENDED_LANGUAGE_CODES.flatMap((raw) => {
  let code: string;
  try {
    code = canonicalLocaleCode(raw);
  } catch {
    return [];
  }
  if (seen.has(code.toLowerCase())) return [];
  // ICU returning the code back means it has no data for it — offering a
  // language we cannot even name would be worse than leaving it out.
  if ((englishNames.of(code) ?? code) === code) return [];
  seen.add(code.toLowerCase());
  return [entry(code, 'extended')];
});

const TIER_ORDER: Record<CommonLocale['tier'], number> = { popular: 0, common: 1, extended: 2 };

export const COMMON_LOCALES: CommonLocale[] = [...curated, ...extended].sort((a, b) => {
  if (a.tier !== b.tier) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
  return a.english.localeCompare(b.english) || a.code.localeCompare(b.code);
});

/** Audience locales — the ones with a country attached. The default offer. */
export const AUDIENCE_LOCALES: CommonLocale[] = COMMON_LOCALES.filter((l) => l.tier !== 'extended');

const BY_CODE = new Map(COMMON_LOCALES.map((locale) => [locale.code.toLowerCase(), locale]));

/** Backward-compatible name for programmatic consumers. */
export const LOCALES: LocaleInfo[] = COMMON_LOCALES;
export const POPULAR = COMMON_LOCALES.filter((locale) => locale.tier === 'popular').map((locale) => locale.code);

/** The audience locales — pt-BR and friends. What "all common languages" means. */
export function allCommonLocaleCodes(): string[] {
  return AUDIENCE_LOCALES.map((locale) => locale.code);
}

/** Everything the catalogue knows, long tail included. */
export function allLocaleCodes(): string[] {
  return COMMON_LOCALES.map((locale) => locale.code);
}

/** Fuzzy lookup over code, English name and endonym, for the picker's search. */
export function searchLocales(query: string): CommonLocale[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return COMMON_LOCALES.filter(
    (locale) =>
      locale.code.toLowerCase().includes(q) ||
      locale.english.toLowerCase().includes(q) ||
      locale.nativeName.toLowerCase().includes(q)
  );
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
