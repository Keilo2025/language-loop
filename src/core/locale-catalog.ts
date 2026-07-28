export type LocaleRegion =
  | 'africa'
  | 'americas'
  | 'asia'
  | 'europe'
  | 'middle-east'
  | 'oceania';

export const REGIONS: { code: LocaleRegion; label: string }[] = [
  { code: 'africa', label: 'Africa' },
  { code: 'americas', label: 'Americas' },
  { code: 'asia', label: 'Asia' },
  { code: 'europe', label: 'Europe' },
  { code: 'middle-east', label: 'Middle East' },
  { code: 'oceania', label: 'Oceania' },
];

export const REGION_LOCALE_CODES: Record<LocaleRegion, readonly string[]> = {
  africa: [
    'af-ZA', 'am-ET', 'ar-EG', 'ar-MA', 'ar-DZ', 'ar-TN', 'en-NG', 'en-ZA',
    'en-KE', 'en-GH', 'fr-CD', 'fr-MA', 'fr-SN', 'fr-CI', 'ha-NG', 'ig-NG',
    'rw-RW', 'so-SO', 'sw-KE', 'sw-TZ', 'sw-UG', 'yo-NG', 'zu-ZA', 'xh-ZA',
    'st-ZA', 'tn-ZA', 'sn-ZW', 'ny-MW', 'mg-MG', 'wo-SN', 'ff-SN', 'ti-ET',
    'om-ET', 'pt-AO', 'pt-MZ',
  ],
  americas: [
    'en-US', 'en-CA', 'es-419', 'es-MX', 'es-AR', 'es-CO', 'es-US', 'es-CL',
    'es-PE', 'es-VE', 'es-EC', 'es-GT', 'es-CR', 'es-DO', 'es-BO', 'es-PY',
    'es-UY', 'es-PR', 'fr-CA', 'pt-BR', 'ht-HT', 'qu-PE', 'gn-PY',
  ],
  asia: [
    'bn-BD', 'bn-IN', 'my-MM', 'zh-Hans-CN', 'zh-Hans-SG', 'zh-Hant-HK',
    'zh-Hant-TW', 'yue-Hant-HK', 'hi-IN', 'id-ID', 'ja-JP', 'jv-ID', 'km-KH',
    'ko-KR', 'ms-MY', 'ms-SG', 'ms-BN', 'mr-IN', 'ne-NP', 'pa-Guru-IN',
    'si-LK', 'ta-IN', 'ta-LK', 'ta-SG', 'te-IN', 'th-TH', 'ur-PK', 'ur-IN',
    'uz-Latn-UZ', 'vi-VN', 'fil-PH', 'ceb-PH', 'gu-IN', 'kn-IN', 'ml-IN',
    'or-IN', 'as-IN', 'kk-KZ', 'mn-MN', 'ky-KG', 'tg-TJ', 'tk-TM', 'lo-LA',
    'ps-AF', 'fa-AF', 'dz-BT', 'dv-MV', 'en-IN', 'en-PK', 'en-PH', 'en-SG',
    'en-MY', 'en-HK',
  ],
  europe: [
    'bg-BG', 'ca-ES', 'cs-CZ', 'da-DK', 'de-DE', 'de-AT', 'de-CH', 'de-LU',
    'el-GR', 'el-CY', 'en-GB', 'en-IE', 'en-MT', 'es-ES', 'et-EE', 'eu-ES',
    'fi-FI', 'fr-FR', 'fr-BE', 'fr-CH', 'fr-LU', 'ga-IE', 'gl-ES', 'hr-HR',
    'hu-HU', 'is-IS', 'it-IT', 'it-CH', 'lb-LU', 'lt-LT', 'lv-LV', 'mk-MK',
    'mt-MT', 'nb-NO', 'nn-NO', 'nl-NL', 'nl-BE', 'pl-PL', 'pt-PT', 'ro-RO',
    'ru-RU', 'ru-BY', 'sk-SK', 'sl-SI', 'sq-AL', 'sr-Cyrl-RS', 'sr-Latn-RS',
    'sv-SE', 'sv-FI', 'uk-UA', 'be-BY', 'bs-BA', 'cy-GB', 'gd-GB', 'hy-AM',
    'ka-GE', 'fo-FO', 'rm-CH', 'br-FR', 'oc-FR', 'co-FR', 'kl-GL',
  ],
  'middle-east': [
    'ar-001', 'ar-EG', 'ar-SA', 'ar-AE', 'ar-IQ', 'ar-JO', 'ar-KW', 'ar-LB',
    'ar-QA', 'ar-BH', 'ar-OM', 'ar-YE', 'ar-SY', 'ar-PS', 'fa-IR', 'he-IL',
    'ckb-IQ', 'ku-TR', 'tr-TR', 'tr-CY',
  ],
  oceania: [
    'en-AU', 'en-NZ', 'mi-NZ', 'sm-WS', 'to-TO', 'fj-FJ', 'ty-PF', 'ch-GU',
    'tpi-PG', 'na-NR', 'mh-MH',
  ],
};

export const POPULAR_LOCALE_CODES = [
  'en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-419', 'es-ES', 'pt-BR', 'pt-PT',
  'it-IT', 'nl-NL', 'pl-PL', 'tr-TR', 'ru-RU', 'ar-001', 'hi-IN', 'id-ID',
  'ja-JP', 'ko-KR', 'zh-Hans-CN', 'zh-Hant-TW',
] as const;

/**
 * Every ISO 639-1 language, plus the three-letter codes with too many speakers
 * to leave out. Region membership for these is derived from ICU rather than
 * listed by hand — `Intl.Locale('sw').maximize()` already knows Swahili is
 * spoken in Tanzania, and `COUNTRY_REGION` turns that into a continent.
 */
export const EXTENDED_LANGUAGE_CODES: readonly string[] = [
  'aa', 'ab', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay', 'az',
  'ba', 'be', 'bg', 'bi', 'bm', 'bn', 'bo', 'br', 'bs',
  'ca', 'ce', 'ch', 'co', 'cs', 'cu', 'cv', 'cy',
  'da', 'de', 'dv', 'dz', 'ee', 'el', 'en', 'eo', 'es', 'et', 'eu',
  'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy',
  'ga', 'gd', 'gl', 'gn', 'gu', 'gv',
  'ha', 'he', 'hi', 'hr', 'ht', 'hu', 'hy', 'hz',
  'ia', 'id', 'ig', 'ii', 'ik', 'io', 'is', 'it', 'iu',
  'ja', 'jv', 'ka', 'kg', 'ki', 'kj', 'kk', 'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kv', 'kw', 'ky',
  'la', 'lb', 'lg', 'li', 'ln', 'lo', 'lt', 'lu', 'lv',
  'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my',
  'na', 'nb', 'nd', 'ne', 'ng', 'nl', 'nn', 'no', 'nr', 'nv', 'ny',
  'oc', 'om', 'or', 'os',
  'pa', 'pl', 'ps', 'pt', 'qu', 'rm', 'rn', 'ro', 'ru', 'rw',
  'sa', 'sc', 'sd', 'se', 'sg', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw',
  'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn', 'to', 'tr', 'ts', 'tt', 'tw', 'ty',
  'ug', 'uk', 'ur', 'uz', 've', 'vi', 'wa', 'wo', 'xh', 'yi', 'yo', 'za', 'zh', 'zu',
  'yue', 'fil', 'ceb', 'ckb', 'nds', 'pap', 'tpi',
];

/**
 * ISO 3166-1 country to macro-region. Used to place a language on the map from
 * whatever country ICU says it is mainly spoken in, so region selection covers
 * every language rather than only the ones somebody remembered to list.
 */
const COUNTRY_GROUPS: Record<LocaleRegion, readonly string[]> = {
  africa: [
    'AO', 'BF', 'BI', 'BJ', 'BW', 'CD', 'CF', 'CG', 'CI', 'CM', 'CV', 'DJ',
    'DZ', 'EG', 'EH', 'ER', 'ET', 'GA', 'GH', 'GM', 'GN', 'GQ', 'GW', 'KE',
    'KM', 'LR', 'LS', 'LY', 'MA', 'MG', 'ML', 'MR', 'MU', 'MW', 'MZ', 'NA',
    'NE', 'NG', 'RE', 'RW', 'SC', 'SD', 'SL', 'SN', 'SO', 'SS', 'ST', 'SZ',
    'TD', 'TG', 'TN', 'TZ', 'UG', 'YT', 'ZA', 'ZM', 'ZW',
  ],
  americas: [
    'AG', 'AI', 'AR', 'AW', 'BB', 'BL', 'BM', 'BO', 'BQ', 'BR', 'BS', 'BZ',
    'CA', 'CL', 'CO', 'CR', 'CU', 'CW', 'DM', 'DO', 'EC', 'FK', 'GD', 'GF',
    'GL', 'GP', 'GT', 'GY', 'HN', 'HT', 'JM', 'KN', 'KY', 'LC', 'MF', 'MQ',
    'MS', 'MX', 'NI', 'PA', 'PE', 'PM', 'PR', 'PY', 'SR', 'SV', 'SX', 'TC',
    'TT', 'US', 'UY', 'VC', 'VE', 'VG', 'VI', '419',
  ],
  asia: [
    'AF', 'AZ', 'BD', 'BN', 'BT', 'CN', 'HK', 'ID', 'IN', 'JP', 'KG', 'KH', 'KP',
    'KR', 'KZ', 'LA', 'LK', 'MM', 'MN', 'MO', 'MV', 'MY', 'NP', 'PH', 'PK',
    'RU', 'SG', 'TH', 'TJ', 'TL', 'TM', 'TW', 'UZ', 'VN',
  ],
  europe: [
    'AD', 'AL', 'AM', 'AT', 'AX', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ',
    'DE', 'DK', 'EE', 'ES', 'FI', 'FO', 'FR', 'GB', 'GE', 'GG', 'GI', 'GR',
    'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU', 'LV', 'MC',
    'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI',
    'SJ', 'SK', 'SM', 'UA', 'VA', 'XK',
  ],
  'middle-east': [
    'AE', 'BH', 'IL', 'IQ', 'IR', 'JO', 'KW', 'LB', 'OM', 'PS', 'QA', 'SA',
    'SY', 'TR', 'YE', '001',
  ],
  oceania: [
    'AS', 'AU', 'CK', 'FJ', 'FM', 'GU', 'KI', 'MH', 'MP', 'NC', 'NF', 'NR',
    'NU', 'NZ', 'PF', 'PG', 'PN', 'PW', 'SB', 'TK', 'TO', 'TV', 'VU', 'WF',
    'WS',
  ],
};

export const COUNTRY_REGION: Record<string, LocaleRegion> = Object.fromEntries(
  (Object.entries(COUNTRY_GROUPS) as [LocaleRegion, readonly string[]][]).flatMap(
    ([region, countries]) => countries.map((country) => [country, region] as const)
  )
);

/**
 * The one instruction that matters most and is easiest to forget: people do not
 * speak the version of their language that gets taught in school.
 */
export const DIALECT_RULE =
  'Write the language as it is actually spoken in the target market today — the ' +
  'everyday register a native speaker would use with a colleague. Do not write the ' +
  'academic, textbook or language-academy standard unless the product is itself ' +
  'formal or governmental. Prefer the ordinary word over the correct-but-unused one.';

export const TRANSLATION_GUIDANCE: Record<string, string> = {
  'de-CH': 'Use Swiss Standard German vocabulary and spelling, including ss instead of ß.',
  'en-GB': 'Use British vocabulary and spelling.',
  'en-US': 'Use American vocabulary and spelling.',
  'es-419': 'Use neutral, natural Latin American Spanish rather than Spain-specific wording.',
  'es-ES': 'Use natural Spanish from Spain.',
  'fr-CA': 'Use natural Canadian French vocabulary.',
  'pt-BR': 'Use natural Brazilian Portuguese vocabulary and spelling.',
  'pt-PT': 'Use natural European Portuguese vocabulary and spelling.',
  'zh-Hans-CN': 'Use Simplified Chinese wording natural to readers in mainland China.',
  'zh-Hant-HK': 'Use Traditional Chinese wording natural to readers in Hong Kong.',
  'zh-Hant-TW': 'Use Traditional Chinese wording natural to readers in Taiwan.',
  'ar-001': 'Modern Standard Arabic, kept plain and contemporary — no classical flourishes.',
  'ar-EG': 'Use wording an Egyptian reader finds natural, avoiding classical constructions.',
  'ar-MA': 'Use Moroccan usage, including the French loanwords people actually say.',
  'ar-SA': 'Use Gulf usage, slightly more formal than Egyptian, still contemporary.',
  'de-AT': 'Use Austrian vocabulary — Jänner, not Januar.',
  'de-DE': 'Use standard German as written in Germany.',
  'en-AU': 'Use Australian vocabulary and spelling.',
  'en-CA': 'Use Canadian vocabulary and spelling.',
  'en-IN': 'Use Indian English vocabulary and register.',
  'es-AR': 'Use Argentine Spanish, including voseo where natural.',
  'es-CO': 'Use Colombian Spanish vocabulary.',
  'es-MX': 'Use Mexican Spanish vocabulary rather than neutral LATAM wording.',
  'es-US': 'Use the Spanish of US Hispanic readers — LATAM base, some English loanwords.',
  'fr-BE': 'Use Belgian French, including septante and nonante.',
  'fr-CH': 'Use Swiss French, including septante and nonante.',
  'fr-FR': 'Use standard French as written in France.',
  'nb-NO': 'Use Bokmål as written in everyday Norwegian.',
  'nl-BE': 'Use Flemish vocabulary rather than Netherlands Dutch.',
  'nl-NL': 'Use Dutch as written in the Netherlands.',
  'pa-Guru-IN': 'Use Punjabi in Gurmukhi script as written in India.',
  'sr-Cyrl-RS': 'Use Serbian in Cyrillic script.',
  'sr-Latn-RS': 'Use Serbian in Latin script.',
  'sw-KE': 'Use Kenyan Swahili usage.',
  'sw-TZ': 'Use Tanzanian Swahili, the standard variety.',
  'uz-Latn-UZ': 'Use Uzbek in Latin script, the current official orthography.',
};
