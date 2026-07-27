import fs from 'node:fs';
import type { Config, WorkItem } from '../types.js';
import { statePath } from './config.js';
import { localeInfo } from './locales.js';

/**
 * The unattended path.
 *
 * Inside a coding agent this file never runs — the agent is the model, reads
 * the brief and writes the translations. `--llm` exists for CI and cron, where
 * nobody is watching. The approval gate still applies afterwards either way.
 */

export interface LlmResult {
  translations: { key: string; locale: string; value: string; note?: string }[];
  model: string;
}

export async function translateWithLlm(cwd: string, work: WorkItem[], config: Config): Promise<LlmResult> {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!anthropic && !openai) {
    throw new Error(
      'No ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment.\n' +
        'Drop --llm and let your coding agent do the translating from .language-loop/brief.md instead — it is free and it can read the code.'
    );
  }

  const brief = fs.readFileSync(statePath(cwd, 'brief.md'), 'utf8');
  const prompt = [
    brief,
    '',
    '---',
    '',
    'Return ONLY a JSON object of the shape {"translations":[{"key","locale","value","note"}]}.',
    'No prose, no code fence, no explanation. Cover every item listed above.',
  ].join('\n');

  if (anthropic) return callAnthropic(prompt, anthropic, work);
  return callOpenAi(prompt, openai!, work);
}

async function callAnthropic(prompt: string, apiKey: string, work: WorkItem[]): Promise<LlmResult> {
  const model = process.env.LANGUAGE_LOOP_MODEL ?? 'claude-sonnet-4-5';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(16000, 400 + work.length * 90),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);
  const json = (await response.json()) as { content: { type: string; text?: string }[] };
  const text = json.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  return { translations: parseTranslations(text), model };
}

async function callOpenAi(prompt: string, apiKey: string, work: WorkItem[]): Promise<LlmResult> {
  const model = process.env.LANGUAGE_LOOP_MODEL ?? 'gpt-4o';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const json = (await response.json()) as { choices: { message: { content: string } }[] };
  return { translations: parseTranslations(json.choices[0]!.message.content), model };
}

function parseTranslations(text: string): LlmResult['translations'] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Model did not return JSON.');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { translations?: LlmResult['translations'] };
  if (!Array.isArray(parsed.translations)) throw new Error('Model returned JSON without a "translations" array.');
  return parsed.translations;
}

/** Sanity check before the API call: is this batch worth the money? */
export function estimateBatch(work: WorkItem[], config: Config): string {
  const locales = new Set(work.map((w) => w.locale));
  const chars = work.reduce((sum, w) => sum + w.source.length, 0);
  return `${work.length} items across ${locales.size} language(s), ${chars.toLocaleString()} source characters`;
}
