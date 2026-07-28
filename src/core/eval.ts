import fs from 'node:fs';

export interface EvalConstraints {
  placeholders: string[];
  icuVariables: string[];
  protectedTerms: string[];
  requiredTerms: string[];
  pluralCategories?: string[];
  maxChars?: number;
}

export interface EvalRecord {
  id: string;
  source: string;
  locale: string;
  kind: string;
  context: string;
  reference: string;
  constraints: EvalConstraints;
  tags: string[];
  criticalMutations: { value: string; error: string }[];
}

export interface EvalCandidate {
  id: string;
  translation: string;
}

export interface EvalFinding {
  id: string;
  locale?: string;
  rule:
    | 'missing-candidate'
    | 'extra-candidate'
    | 'placeholder'
    | 'icu-variable'
    | 'icu-syntax'
    | 'plural-category'
    | 'protected-term'
    | 'required-term'
    | 'max-length'
    | 'critical-mutation'
    | 'reference-mismatch';
  severity: 'error' | 'warning';
  message: string;
}

export interface EvalLocaleSummary {
  total: number;
  passed: number;
  referenceMatches: number;
  errors: number;
}

export interface EvalReport {
  ok: boolean;
  total: number;
  passed: number;
  referenceMatches: number;
  findings: EvalFinding[];
  byLocale: Record<string, EvalLocaleSummary>;
}

export function loadEvalCorpus(file: string): EvalRecord[] {
  const records = readJsonl<unknown>(file);
  const seen = new Set<string>();
  return records.map((raw, index) => {
    const record = raw as Partial<EvalRecord> | null;
    const label = `${file}:${index + 1}`;
    if (
      !record
      || typeof record.id !== 'string'
      || typeof record.source !== 'string'
      || typeof record.locale !== 'string'
      || typeof record.kind !== 'string'
      || typeof record.context !== 'string'
      || typeof record.reference !== 'string'
      || !record.constraints
      || !Array.isArray(record.tags)
      || !Array.isArray(record.criticalMutations)
    ) {
      throw new Error(`${label} is not a valid multilingual evaluation record.`);
    }
    if (seen.has(record.id)) throw new Error(`${file} has duplicate evaluation id ${record.id}.`);
    seen.add(record.id);
    for (const field of ['placeholders', 'icuVariables', 'protectedTerms', 'requiredTerms'] as const) {
      if (!Array.isArray(record.constraints[field])) {
        throw new Error(`${label} constraints.${field} must be an array.`);
      }
    }
    return record as EvalRecord;
  });
}

export function loadEvalCandidates(file: string): EvalCandidate[] {
  const records = readJsonl<unknown>(file);
  const seen = new Set<string>();
  return records.map((raw, index) => {
    const candidate = raw as Partial<EvalCandidate> | null;
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.translation !== 'string') {
      throw new Error(`${file}:${index + 1} is not a valid evaluation candidate.`);
    }
    if (seen.has(candidate.id)) throw new Error(`${file} has duplicate candidate id ${candidate.id}.`);
    seen.add(candidate.id);
    return candidate as EvalCandidate;
  });
}

export function evaluateCorpus(
  corpus: EvalRecord[],
  candidates: EvalCandidate[]
): EvalReport {
  const findings: EvalFinding[] = [];
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const corpusById = new Map(corpus.map((record) => [record.id, record]));
  const byLocale: Record<string, EvalLocaleSummary> = {};
  const passedIds = new Set<string>();
  let referenceMatches = 0;

  for (const record of corpus) {
    const locale = byLocale[record.locale] ??= {
      total: 0,
      passed: 0,
      referenceMatches: 0,
      errors: 0,
    };
    locale.total++;
    const candidate = candidateById.get(record.id);
    if (!candidate) {
      add(findings, record, 'missing-candidate', 'error', 'candidate file has no translation for this record');
      locale.errors++;
      continue;
    }
    const beforeErrors = errorCount(findings, record.id);
    checkRecord(record, candidate.translation, findings);
    const matchedReference = normalize(candidate.translation) === normalize(record.reference);
    if (matchedReference) {
      referenceMatches++;
      locale.referenceMatches++;
    } else {
      add(
        findings,
        record,
        'reference-mismatch',
        'warning',
        'candidate differs from the reviewed reference; semantic review may still accept it'
      );
    }
    const errors = errorCount(findings, record.id) - beforeErrors;
    locale.errors += errors;
    if (!errors) {
      passedIds.add(record.id);
      locale.passed++;
    }
  }

  for (const candidate of candidates) {
    if (corpusById.has(candidate.id)) continue;
    findings.push({
      id: candidate.id,
      rule: 'extra-candidate',
      severity: 'error',
      message: 'candidate id does not exist in the corpus',
    });
  }

  return {
    ok: !findings.some((finding) => finding.severity === 'error'),
    total: corpus.length,
    passed: passedIds.size,
    referenceMatches,
    findings,
    byLocale,
  };
}

function checkRecord(record: EvalRecord, translation: string, findings: EvalFinding[]): void {
  for (const placeholder of record.constraints.placeholders) {
    const wanted = occurrences(record.source, placeholder);
    const got = occurrences(translation, placeholder);
    if (wanted !== got) {
      add(
        findings,
        record,
        'placeholder',
        'error',
        `${placeholder} occurs ${wanted} time(s) in source and ${got} in candidate`
      );
    }
  }
  for (const variable of record.constraints.icuVariables) {
    const found = new RegExp(`\\{\\s*${escapeRegExp(variable)}\\s*,\\s*(plural|select|selectordinal)\\s*,`).test(
      translation
    );
    if (!found) add(findings, record, 'icu-variable', 'error', `missing ICU variable ${variable}`);
  }
  if (!balancedBraces(translation)) {
    add(findings, record, 'icu-syntax', 'error', 'candidate has unbalanced ICU braces');
  }
  for (const category of record.constraints.pluralCategories ?? []) {
    if (!new RegExp(`(?:^|[\\s,])${escapeRegExp(category)}\\s*\\{`).test(translation)) {
      add(findings, record, 'plural-category', 'error', `missing ${category} plural category`);
    }
  }
  for (const term of record.constraints.protectedTerms) {
    if (!translation.includes(term)) {
      add(findings, record, 'protected-term', 'error', `protected term "${term}" was changed or removed`);
    }
  }
  const lower = translation.toLocaleLowerCase();
  for (const term of record.constraints.requiredTerms) {
    if (!lower.includes(term.toLocaleLowerCase())) {
      add(findings, record, 'required-term', 'error', `required terminology "${term}" is missing`);
    }
  }
  if (record.constraints.maxChars !== undefined && translation.length > record.constraints.maxChars) {
    add(
      findings,
      record,
      'max-length',
      'error',
      `candidate has ${translation.length} characters; maximum is ${record.constraints.maxChars}`
    );
  }
  const normalized = normalize(translation);
  const mutation = record.criticalMutations.find((item) => normalize(item.value) === normalized);
  if (mutation) add(findings, record, 'critical-mutation', 'error', mutation.error);
}

function add(
  findings: EvalFinding[],
  record: EvalRecord,
  rule: EvalFinding['rule'],
  severity: EvalFinding['severity'],
  message: string
): void {
  findings.push({ id: record.id, locale: record.locale, rule, severity, message });
}

function readJsonl<T>(file: string): T[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read evaluation file ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as T];
    } catch (error) {
      throw new Error(
        `${file}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

function normalize(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function occurrences(text: string, token: string): number {
  if (!token) return 0;
  let count = 0;
  let from = 0;
  while ((from = text.indexOf(token, from)) !== -1) {
    count++;
    from += token.length;
  }
  return count;
}

function balancedBraces(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function errorCount(findings: EvalFinding[], id: string): number {
  return findings.filter((finding) => finding.id === id && finding.severity === 'error').length;
}
