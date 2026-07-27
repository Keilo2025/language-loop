import {
  COMMON_LOCALES,
  REGIONS,
  allCommonLocaleCodes,
  canonicalLocaleCode,
  localesForRegions,
  type LocaleRegion,
} from './locales.js';

export type LocaleSelectionMode = 'popular' | 'regions' | 'all' | 'custom';

export interface LocaleSelectionInput {
  sourceLocale: string;
  mode: LocaleSelectionMode;
  regions?: string[];
  codes?: string[];
}

export function parseRegionCodes(values: string[]): LocaleRegion[] {
  const valid = new Set(REGIONS.map((region) => region.code));
  const normalized = values.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) throw new Error('Choose at least one region.');

  const unknown = normalized.filter((value) => !valid.has(value as LocaleRegion));
  if (unknown.length) {
    throw new Error(
      `Unknown region: ${unknown.join(', ')}. Choose from: ${REGIONS.map((region) => region.code).join(', ')}.`
    );
  }
  return [...new Set(normalized)] as LocaleRegion[];
}

export function resolveLocaleSelection(input: LocaleSelectionInput): string[] {
  const source = canonicalLocaleCode(input.sourceLocale);
  let targets: string[];

  switch (input.mode) {
    case 'all':
      targets = allCommonLocaleCodes();
      break;
    case 'regions':
      targets = localesForRegions(parseRegionCodes(input.regions ?? [])).map((locale) => locale.code);
      break;
    case 'popular':
      targets = COMMON_LOCALES.filter((locale) => locale.tier === 'popular').map((locale) => locale.code);
      break;
    case 'custom':
      if (!input.codes?.length) throw new Error('Enter at least one locale code.');
      targets = input.codes.map(canonicalLocaleCode);
      break;
  }

  return [source, ...targets.filter((code) => code !== source)];
}
