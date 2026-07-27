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
    'af-ZA', 'am-ET', 'ar-EG', 'ar-MA', 'en-NG', 'en-ZA', 'fr-CD', 'fr-MA',
    'ha-NG', 'ig-NG', 'rw-RW', 'so-SO', 'sw-KE', 'sw-TZ', 'yo-NG', 'zu-ZA',
  ],
  americas: [
    'en-US', 'en-CA', 'es-419', 'es-MX', 'es-AR', 'es-CO', 'es-US', 'fr-CA',
    'pt-BR', 'ht-HT', 'qu-PE',
  ],
  asia: [
    'bn-BD', 'my-MM', 'zh-Hans-CN', 'zh-Hant-HK', 'zh-Hant-TW', 'hi-IN',
    'id-ID', 'ja-JP', 'jv-ID', 'km-KH', 'ko-KR', 'ms-MY', 'mr-IN', 'ne-NP',
    'pa-Guru-IN', 'si-LK', 'ta-IN', 'te-IN', 'th-TH', 'ur-PK', 'uz-Latn-UZ',
    'vi-VN', 'fil-PH', 'gu-IN', 'kn-IN', 'ml-IN', 'kk-KZ', 'mn-MN',
  ],
  europe: [
    'bg-BG', 'ca-ES', 'cs-CZ', 'da-DK', 'de-DE', 'de-AT', 'de-CH', 'el-GR',
    'en-GB', 'es-ES', 'et-EE', 'eu-ES', 'fi-FI', 'fr-FR', 'ga-IE', 'hr-HR',
    'hu-HU', 'is-IS', 'it-IT', 'lt-LT', 'lv-LV', 'mk-MK', 'nb-NO', 'nl-NL',
    'nl-BE', 'pl-PL', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'sl-SI',
    'sr-Cyrl-RS', 'sr-Latn-RS', 'sv-SE', 'uk-UA', 'cy-GB',
  ],
  'middle-east': [
    'ar-001', 'ar-EG', 'ar-SA', 'ar-AE', 'fa-IR', 'he-IL', 'ckb-IQ', 'tr-TR',
  ],
  oceania: ['en-AU', 'en-NZ', 'mi-NZ', 'sm-WS'],
};

export const POPULAR_LOCALE_CODES = [
  'en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-419', 'es-ES', 'pt-BR', 'pt-PT',
  'it-IT', 'nl-NL', 'pl-PL', 'tr-TR', 'ru-RU', 'ar-001', 'hi-IN', 'id-ID',
  'ja-JP', 'ko-KR', 'zh-Hans-CN', 'zh-Hant-TW',
] as const;

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
};
