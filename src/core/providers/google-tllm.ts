import type { TranslationProvider, TranslationProviderRequest, FetchLike } from '../providers.js';
import { requestJson } from '../providers.js';

export interface GoogleTllmOptions {
  apiKey?: string;
  accessToken?: string;
  project?: string;
  location?: string;
  model?: string;
  fetch?: FetchLike;
}

export class GoogleTllmProvider implements TranslationProvider {
  readonly id = 'google-tllm';

  constructor(private options: GoogleTllmOptions = {}) {}

  async translate(
    request: TranslationProviderRequest
  ): Promise<{ key: string; locale: string; value: string; note?: string }[]> {
    const units = request.batch.units;
    if (!units.length) return [];
    if (units.length > 1_024) {
      throw new Error(`Google TLLM accepts at most 1024 strings per request; received ${units.length}.`);
    }
    const locales = new Set(units.map((unit) => unit.locale));
    if (locales.size !== 1) {
      throw new Error('Google TLLM batches must contain exactly one target locale.');
    }
    const target = units[0]!.locale;
    const source = request.batch.sourceLocale;
    const project = this.options.project
      ?? request.config.ai.google.project
      ?? process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new Error(
        'Google TLLM needs a project ID. Set GOOGLE_CLOUD_PROJECT or ai.google.project.'
      );
    }
    const location = this.options.location ?? request.config.ai.google.location ?? 'global';
    const modelId = this.options.model ?? request.config.ai.google.model ?? 'general/translation-llm';
    const model = `projects/${project}/locations/${location}/models/${modelId}`;
    const apiKey = this.options.apiKey ?? process.env.GOOGLE_CLOUD_TRANSLATION_API_KEY;
    const accessToken = this.options.accessToken ?? process.env.GOOGLE_CLOUD_ACCESS_TOKEN;
    if (!apiKey && !accessToken) {
      throw new Error(
        'Google TLLM credentials are missing. Set GOOGLE_CLOUD_TRANSLATION_API_KEY ' +
        'or GOOGLE_CLOUD_ACCESS_TOKEN.'
      );
    }

    const common = {
      fetch: this.options.fetch,
      timeoutMs: request.config.ai.requestTimeoutMs,
      transientRetries: request.config.ai.transientRetries,
    };
    let translated: unknown[];
    if (accessToken) {
      const url =
        `https://translation.googleapis.com/v3/projects/${encodeURIComponent(project)}` +
        `/locations/${encodeURIComponent(location)}:translateText`;
      const response = await requestJson<{
        translations?: { translatedText?: unknown }[];
      }>(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'x-goog-user-project': project,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          contents: units.map((unit) => unit.source),
          mimeType: 'text/plain',
          sourceLanguageCode: source,
          targetLanguageCode: target,
          model,
        }),
      }, common);
      translated = response.translations ?? [];
    } else {
      const url =
        'https://translation.googleapis.com/language/translate/v2?' +
        new URLSearchParams({ key: apiKey! }).toString();
      const response = await requestJson<{
        data?: { translations?: { translatedText?: unknown }[] };
      }>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          q: units.map((unit) => unit.source),
          source,
          target,
          model,
        }),
      }, common);
      translated = response.data?.translations ?? [];
    }

    if (translated.length !== units.length) {
      throw new Error(
        `Google TLLM returned ${translated.length} translation(s); expected ${units.length}.`
      );
    }
    return units.map((unit, index) => {
      const value = translated[index] && typeof (translated[index] as { translatedText?: unknown }).translatedText === 'string'
        ? decodeHtmlEntities((translated[index] as { translatedText: string }).translatedText)
        : null;
      if (value === null) {
        throw new Error(`Google TLLM response ${index + 1} has no translatedText string.`);
      }
      return { key: unit.key, locale: unit.locale, value };
    });
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
