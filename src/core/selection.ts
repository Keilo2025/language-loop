import type {
  Config,
  LanguageProgress,
  Memory,
  MemoryEntry,
  MessageCategory,
  MessageFilter,
  ResolvedMessageFilter,
  StringKind,
} from '../types.js';
import { canonicalLocaleCode } from './locales.js';

const CATEGORY_KINDS: Record<MessageCategory, readonly StringKind[]> = {
  cta: ['cta'],
  button: ['cta'],
  headline: ['heading', 'title'],
  navigation: ['nav'],
  label: ['label'],
  body: ['body'],
  placeholder: ['placeholder'],
  accessibility: ['alt', 'aria'],
  error: ['error'],
  'empty-state': ['empty-state'],
  meta: ['meta'],
  toast: ['toast'],
  unknown: ['unknown'],
};

type SelectableEntry = Pick<MemoryEntry, 'kind' | 'namespace'>;

export class LanguageLoopSelectionError extends Error {
  constructor(
    public readonly code: 'INVALID_FILTER' | 'FILTER_MISMATCH' | 'INVALID_LOCALE',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'LanguageLoopSelectionError';
  }
}

/** Resolve friendly selectors once to the exact canonical keys execution may touch. */
export function resolveMessageFilter(
  entries: Readonly<Record<string, SelectableEntry>>,
  filter?: MessageFilter,
): ResolvedMessageFilter {
  if (filter === undefined) {
    return {
      requested: { categories: [], groups: [], keys: [] },
      kinds: [],
      selectedKeys: Object.keys(entries).sort(),
      unmatchedGroups: [],
      unmatchedKeys: [],
    };
  }
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    throw new LanguageLoopSelectionError('INVALID_FILTER', 'filter must be an object');
  }

  const categories = stringList(filter.categories, 'categories') as MessageCategory[];
  const groups = stringList(filter.groups, 'groups');
  const keys = stringList(filter.keys, 'keys');
  const invalidCategory = categories.find((category) => !(category in CATEGORY_KINDS));
  if (invalidCategory) {
    throw new LanguageLoopSelectionError(
      'INVALID_FILTER',
      `unsupported category "${invalidCategory}"`,
    );
  }

  const kinds = [...new Set(categories.flatMap((category) => CATEGORY_KINDS[category]))].sort();
  const kindSet = new Set<StringKind>(kinds);
  const groupSet = new Set(groups);
  const keySet = new Set(keys);
  const selected = Object.entries(entries)
    .filter(([key, entry]) =>
      kindSet.has(entry.kind) ||
      groupSet.has(entry.namespace) ||
      keySet.has(key),
    )
    .map(([key]) => key)
    .sort();

  const existingGroups = new Set(Object.values(entries).map((entry) => entry.namespace));
  const unmatchedGroups = groups.filter((group) => !existingGroups.has(group));
  const unmatchedKeys = keys.filter((key) => !(key in entries));
  if (unmatchedGroups.length || unmatchedKeys.length) {
    const details = [
      unmatchedGroups.length ? `groups: ${unmatchedGroups.join(', ')}` : '',
      unmatchedKeys.length ? `keys: ${unmatchedKeys.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new LanguageLoopSelectionError(
      'FILTER_MISMATCH',
      `explicit selectors do not match the active catalogue (${details})`,
    );
  }

  return {
    requested: { categories, groups, keys },
    kinds,
    selectedKeys: selected,
    unmatchedGroups,
    unmatchedKeys,
  };
}

/** Validate that an embedded caller can only select configured target locales. */
export function resolveTargetLocales(
  config: Pick<Config, 'sourceLocale' | 'locales'>,
  requested?: readonly string[],
): string[] {
  const source = canonicalLocaleCode(config.sourceLocale);
  const configured = config.locales
    .map(canonicalLocaleCode)
    .filter((locale) => locale !== source);
  if (requested === undefined) return [...new Set(configured)];
  if (!Array.isArray(requested) || requested.some((locale) => typeof locale !== 'string')) {
    throw new LanguageLoopSelectionError(
      'INVALID_LOCALE',
      'target locales must be an array of locale codes',
    );
  }
  const resolved = [...new Set(requested.map(canonicalLocaleCode))];
  const configuredSet = new Set(configured);
  const invalid = resolved.filter((locale) => !configuredSet.has(locale));
  if (invalid.length) {
    throw new LanguageLoopSelectionError(
      'INVALID_LOCALE',
      `not configured target locale(s): ${invalid.join(', ')}`,
    );
  }
  return resolved;
}

/** Compute terminal truth for the exact key/locale selection. */
export function languageProgress(
  memory: Memory,
  locales: readonly string[],
  selectedKeys: ReadonlySet<string>,
  marketingKeys: ReadonlySet<string>,
): LanguageProgress[] {
  return locales.map((locale) => {
    let accepted = 0;
    let pending = 0;
    let marketingBlocked = 0;
    let needsHuman = 0;

    for (const key of selectedKeys) {
      const entry = memory.entries[key];
      if (marketingKeys.has(key)) {
        marketingBlocked++;
        continue;
      }
      const translation = entry?.translations[locale];
      if (
        entry &&
        translation?.sourceHash === entry.sourceHash &&
        translation.status === 'needs-human'
      ) {
        needsHuman++;
      } else if (
        entry &&
        translation?.sourceHash === entry.sourceHash &&
        (translation.status === 'approved' || translation.status === 'manual')
      ) {
        accepted++;
      } else {
        pending++;
      }
    }

    const status: LanguageProgress['status'] = pending
      ? 'pending'
      : marketingBlocked
        ? 'waiting-marketing'
        : needsHuman
          ? 'needs-human'
          : 'complete';
    return {
      locale,
      total: selectedKeys.size,
      accepted,
      pending,
      marketingBlocked,
      needsHuman,
      status,
    };
  });
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new LanguageLoopSelectionError(
      'INVALID_FILTER',
      `${field} must be an array of strings`,
    );
  }
  const normalized = value.map((item) => item.trim());
  if (normalized.some((item) => !item)) {
    throw new LanguageLoopSelectionError(
      'INVALID_FILTER',
      `${field} entries must be non-empty strings`,
    );
  }
  return [...new Set(normalized)].sort();
}
