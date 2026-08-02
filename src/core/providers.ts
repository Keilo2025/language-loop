import type {
  ComponentContext,
  Config,
  TranslationArtifact,
  TranslationBatch,
  TranslationUnit,
  Verdict,
} from '../types.js';

export interface TranslationProviderRequest {
  batch: TranslationBatch;
  contexts: ReadonlyMap<string, ComponentContext>;
  config: Config;
}

export interface JudgeProviderRequest {
  batch: TranslationBatch;
  translations: TranslationArtifact;
  units: TranslationUnit[];
  contexts: ReadonlyMap<string, ComponentContext>;
  config: Config;
}

export interface TranslationProvider {
  readonly id: string;
  /**
   * Preflight check run before the loop starts. Returns one human-readable
   * problem per unmet requirement, each naming its fix; empty means ready.
   */
  checkRequirements?(config: Config): string[];
  translate(
    request: TranslationProviderRequest
  ): Promise<{ key: string; locale: string; value: string; note?: string }[]>;
}

export interface JudgeProvider {
  readonly id: string;
  checkRequirements?(config: Config): string[];
  judge(request: JudgeProviderRequest): Promise<Verdict[]>;
}

export class ProviderRegistry {
  private translators = new Map<string, TranslationProvider>();
  private judges = new Map<string, JudgeProvider>();

  registerTranslator(provider: TranslationProvider): this {
    if (this.translators.has(provider.id)) {
      throw new Error(`Translator provider "${provider.id}" is already registered.`);
    }
    this.translators.set(provider.id, provider);
    return this;
  }

  registerJudge(provider: JudgeProvider): this {
    if (this.judges.has(provider.id)) {
      throw new Error(`Judge provider "${provider.id}" is already registered.`);
    }
    this.judges.set(provider.id, provider);
    return this;
  }

  translator(id: string): TranslationProvider {
    const provider = this.translators.get(id);
    if (provider) return provider;
    throw new Error(
      `Unknown translator provider "${id}". Supported translators: ${list(this.translators)}.`
    );
  }

  judge(id: string): JudgeProvider {
    const provider = this.judges.get(id);
    if (provider) return provider;
    throw new Error(`Unknown judge provider "${id}". Supported judges: ${list(this.judges)}.`);
  }

  translatorIds(): string[] {
    return [...this.translators.keys()].sort();
  }

  judgeIds(): string[] {
    return [...this.judges.keys()].sort();
  }
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface JsonRequestOptions {
  fetch?: FetchLike;
  timeoutMs: number;
  transientRetries: number;
}

export async function requestJson<T = unknown>(
  url: string,
  init: RequestInit,
  options: JsonRequestOptions
): Promise<T> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('This Node.js runtime does not provide fetch.');
  const retries = Math.max(0, options.transientRetries);
  const safeEndpoint = endpointLabel(url);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const parentSignal = init.signal;
    const forwardAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) forwardAbort();
    else parentSignal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error(`Provider request timed out after ${options.timeoutMs}ms.`)),
      Math.max(1, options.timeoutMs)
    );
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        const detail = redactSensitive(text.slice(0, 500)).trim();
        const error = new ProviderHttpError(
          response.status,
          `Provider request to ${safeEndpoint} failed with ${response.status}${detail ? `: ${detail}` : '.'}`
        );
        if (isTransientStatus(response.status) && attempt < retries) continue;
        throw error;
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ProviderResponseError(
          `Provider request to ${safeEndpoint} returned invalid JSON.`
        );
      }
    } catch (error) {
      if (controller.signal.aborted && !parentSignal?.aborted) {
        throw new Error(`Provider request to ${safeEndpoint} timed out after ${options.timeoutMs}ms.`);
      }
      if (error instanceof ProviderHttpError) throw error;
      if (error instanceof ProviderResponseError) throw error;
      if (attempt < retries) continue;
      const detail = redactSensitive(error instanceof Error ? error.message : String(error));
      throw new Error(`Provider request to ${safeEndpoint} failed: ${detail}`);
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', forwardAbort);
    }
  }
  throw new Error(`Provider request to ${safeEndpoint} exhausted its retry ceiling.`);
}

class ProviderHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

class ProviderResponseError extends Error {}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function endpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[provider endpoint]';
  }
}

function redactSensitive(text: string): string {
  return text
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]');
}

function list<T>(providers: Map<string, T>): string {
  const ids = [...providers.keys()].sort();
  return ids.length ? ids.join(', ') : '(none registered)';
}
