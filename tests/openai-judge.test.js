import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../dist/core/config.js';
import { bindTranslationArtifact, createBatch } from '../dist/core/batch.js';
import { OpenAiJudgeProvider } from '../dist/core/providers/openai-judge.js';

function fixture(fetchImpl, outputOverride) {
  const config = {
    ...defaultConfig({
      framework: 'react',
      runtime: 'react-i18next',
      messagesDir: 'messages',
      layout: 'single-file',
      srcDir: 'src',
      runtimeInstalled: true,
      evidence: [],
    }),
    sourceLocale: 'en-US',
    locales: ['en-US', 'de-DE'],
  };
  const work = [{
    key: 'hero.cta',
    locale: 'de-DE',
    source: 'Start free',
    kind: 'cta',
    file: 'src/Hero.tsx',
    line: 7,
    component: 'Hero',
    placeholders: [],
    reason: 'new',
  }];
  const batch = createBatch(work, {
    id: 'openai-batch',
    sourceLocale: 'en-US',
    contextHashes: new Map([['hero.cta::de-DE', 'context-hash']]),
  });
  const translations = bindTranslationArtifact(batch, [{
    key: 'hero.cta',
    locale: 'de-DE',
    value: 'Kostenlos starten',
  }], 'google-tllm');
  const candidate = translations.translations[0];
  const output = outputOverride ?? {
    verdicts: [{
      key: candidate.key,
      locale: candidate.locale,
      ok: true,
      reason: null,
      sourceHash: candidate.sourceHash,
      candidateHash: candidate.candidateHash,
    }],
  };
  const contexts = new Map([['hero.cta::de-DE', {
    version: 1,
    key: 'hero.cta',
    locale: 'de-DE',
    file: 'src/Hero.tsx',
    component: 'Hero',
    line: 7,
    startLine: 4,
    endLine: 10,
    excerpt: '7: return <button>{t("hero.cta")}</button>;',
    neighborKeys: ['hero.title'],
    hash: 'context-hash',
  }]]);
  return {
    provider: new OpenAiJudgeProvider({ apiKey: 'openai-secret', fetch: fetchImpl }),
    request: {
      batch,
      translations,
      units: [{
        key: candidate.key,
        locale: candidate.locale,
        source: 'Start free',
        value: candidate.value,
        kind: 'cta',
        file: 'src/Hero.tsx',
        placeholders: [],
        status: 'pending',
      }],
      contexts,
      config,
    },
    output,
  };
}

test('GPT-5.6 judge uses Responses API, low reasoning, and strict structured output', async () => {
  let captured;
  let output;
  const fetchImpl = async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(output) }],
      }],
    }), { status: 200 });
  };
  const setup = fixture(fetchImpl);
  output = setup.output;
  const verdicts = await setup.provider.judge(setup.request);

  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.init.headers.authorization, 'Bearer openai-secret');
  assert.equal(captured.body.model, 'gpt-5.6-terra');
  assert.deepEqual(captured.body.reasoning, { effort: 'low' });
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.text.format.type, 'json_schema');
  assert.equal(captured.body.text.format.strict, true);
  assert.equal(captured.body.text.format.schema.additionalProperties, false);
  assert.match(JSON.stringify(captured.body.input), /context-hash/);
  assert.match(JSON.stringify(captured.body.input), /candidateHash/);
  assert.deepEqual(verdicts, [{ key: 'hero.cta', locale: 'de-DE', ok: true }]);
});

test('GPT-5.6 judge fails closed on stale hashes, prose, and incomplete sets', async () => {
  let responseText = 'not json';
  const fetchImpl = async () => new Response(JSON.stringify({
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: responseText }],
    }],
  }), { status: 200 });
  const setup = fixture(fetchImpl);
  await assert.rejects(setup.provider.judge(setup.request), /valid JSON/i);

  responseText = JSON.stringify({
    verdicts: [{ ...setup.output.verdicts[0], candidateHash: 'stale' }],
  });
  await assert.rejects(setup.provider.judge(setup.request), /candidate hash/i);

  responseText = JSON.stringify({ verdicts: [] });
  await assert.rejects(setup.provider.judge(setup.request), /missing.*hero\.cta::de-DE/i);
});
