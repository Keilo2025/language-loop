import type { Verdict } from '../../types.js';
import type { FetchLike, JudgeProvider, JudgeProviderRequest } from '../providers.js';
import { requestJson } from '../providers.js';
import { unitId } from '../batch.js';

export interface OpenAiJudgeOptions {
  apiKey?: string;
  model?: string;
  fetch?: FetchLike;
}

export class OpenAiJudgeProvider implements JudgeProvider {
  readonly id = 'openai-gpt-5.6-terra';

  constructor(private options: OpenAiJudgeOptions = {}) {}

  checkRequirements(): string[] {
    if (this.options.apiKey ?? process.env.OPENAI_API_KEY) return [];
    return [
      'openai-gpt-5.6-terra: no OPENAI_API_KEY. Create a key at ' +
      'https://platform.openai.com/api-keys and add OPENAI_API_KEY=sk-... to the project .env.',
    ];
  }

  async judge(request: JudgeProviderRequest): Promise<Verdict[]> {
    const apiKey = this.options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('GPT-5.6 judging needs OPENAI_API_KEY.');
    const candidates = new Map(
      request.translations.translations.map((item) => [unitId(item.key, item.locale), item])
    );
    const expected = new Map(
      request.units.map((unit) => [unitId(unit.key, unit.locale), unit])
    );
    const records = request.units.map((unit) => {
      const id = unitId(unit.key, unit.locale);
      const candidate = candidates.get(id);
      if (!candidate) throw new Error(`GPT-5.6 judge input is missing candidate ${id}.`);
      const context = request.contexts.get(id);
      if (!context || context.hash !== request.batch.units.find(
        (batchUnit) => unitId(batchUnit.key, batchUnit.locale) === id
      )?.contextHash) {
        throw new Error(`GPT-5.6 judge context hash does not match ${id}.`);
      }
      return {
        key: unit.key,
        locale: unit.locale,
        source: unit.source,
        candidate: unit.value,
        kind: unit.kind,
        sourceHash: candidate.sourceHash,
        candidateHash: candidate.candidateHash,
        context,
      };
    });
    const schema = verdictSchema();
    const response = await requestJson<OpenAiResponse>(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model ?? request.config.ai.openai.model ?? 'gpt-5.6-terra',
          reasoning: {
            effort: request.config.ai.openai.reasoningEffort ?? 'low',
          },
          store: false,
          input: [
            {
              role: 'system',
              content:
                'You are an independent localization quality judge. Do not translate or rewrite. ' +
                'Approve only when the candidate preserves meaning, register, locale, UI function, ' +
                'and the supplied component context. Reject defensible risks with a precise correction.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                batchId: request.batch.id,
                voice: request.config.voice,
                records,
              }),
            },
          ],
          text: {
            verbosity: 'low',
            format: {
              type: 'json_schema',
              name: 'translation_verdicts',
              strict: true,
              schema,
            },
          },
          max_output_tokens: Math.max(1_000, request.units.length * 180),
        }),
      },
      {
        fetch: this.options.fetch,
        timeoutMs: request.config.ai.requestTimeoutMs,
        transientRetries: request.config.ai.transientRetries,
      }
    );
    const outputText = response.output
      ?.flatMap((item) => item.type === 'message' && Array.isArray(item.content) ? item.content : [])
      .find((content) => content.type === 'output_text' && typeof content.text === 'string')
      ?.text;
    if (!outputText) throw new Error('GPT-5.6 judge returned no structured output text.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new Error('GPT-5.6 judge did not return valid JSON.');
    }
    return validateJudgeOutput(parsed, expected, candidates);
  }
}

interface OpenAiResponse {
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
  }[];
}

function validateJudgeOutput(
  input: unknown,
  expected: Map<string, JudgeProviderRequest['units'][number]>,
  candidates: Map<string, JudgeProviderRequest['translations']['translations'][number]>
): Verdict[] {
  const value = input as { verdicts?: unknown } | null;
  if (!value || !Array.isArray(value.verdicts)) {
    throw new Error('GPT-5.6 judge output has no verdicts array.');
  }
  const seen = new Set<string>();
  const verdicts: Verdict[] = [];
  for (const raw of value.verdicts) {
    const record = raw as Record<string, unknown> | null;
    if (!record || typeof record.key !== 'string' || typeof record.locale !== 'string') {
      throw new Error('GPT-5.6 judge returned a verdict without key and locale.');
    }
    const id = unitId(record.key, record.locale);
    if (seen.has(id)) throw new Error(`GPT-5.6 judge returned duplicate verdict ${id}.`);
    seen.add(id);
    if (!expected.has(id)) throw new Error(`GPT-5.6 judge returned extra verdict ${id}.`);
    const candidate = candidates.get(id)!;
    if (record.sourceHash !== candidate.sourceHash) {
      throw new Error(`GPT-5.6 judge source hash does not match ${id}.`);
    }
    if (record.candidateHash !== candidate.candidateHash) {
      throw new Error(`GPT-5.6 judge candidate hash does not match ${id}.`);
    }
    if (typeof record.ok !== 'boolean') throw new Error(`GPT-5.6 verdict ${id} has no boolean ok.`);
    if (!record.ok && !(typeof record.reason === 'string' && record.reason.trim())) {
      throw new Error(`GPT-5.6 rejected verdict ${id} has no reason.`);
    }
    verdicts.push({
      key: record.key,
      locale: record.locale,
      ok: record.ok,
      ...(typeof record.reason === 'string' && record.reason.trim()
        ? { reason: record.reason.trim() }
        : {}),
    });
  }
  const missing = [...expected.keys()].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`GPT-5.6 judge output is missing ${missing.join(', ')}.`);
  return verdicts;
}

function verdictSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            locale: { type: 'string' },
            ok: { type: 'boolean' },
            reason: { type: ['string', 'null'] },
            sourceHash: { type: 'string' },
            candidateHash: { type: 'string' },
          },
          required: ['key', 'locale', 'ok', 'reason', 'sourceHash', 'candidateHash'],
          additionalProperties: false,
        },
      },
    },
    required: ['verdicts'],
    additionalProperties: false,
  };
}
