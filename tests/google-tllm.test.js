import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../dist/core/config.js';
import { createBatch } from '../dist/core/batch.js';
import { GoogleTllmProvider } from '../dist/core/providers/google-tllm.js';

function request(fetchImpl) {
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
  const work = ['Welcome', 'Start free'].map((source, index) => ({
    key: `key.${index}`,
    locale: 'de-DE',
    source,
    kind: index ? 'cta' : 'heading',
    file: 'src/App.tsx',
    placeholders: [],
    reason: 'new',
  }));
  return {
    config,
    batch: createBatch(work, { id: 'google-batch', sourceLocale: 'en-US' }),
    contexts: new Map(),
    fetchImpl,
  };
}

test('Google TLLM API-key adapter uses Basic v2 with the full model resource', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      data: {
        translations: [
          { translatedText: 'Willkommen' },
          { translatedText: 'Kostenlos starten' },
        ],
      },
    }), { status: 200 });
  };
  const req = request(fetchImpl);
  const provider = new GoogleTllmProvider({
    apiKey: 'google-secret',
    project: 'project-id',
    location: 'global',
    fetch: fetchImpl,
  });
  const result = await provider.translate(req);

  assert.match(captured.url, /\/language\/translate\/v2\?key=google-secret$/);
  assert.deepEqual(captured.body.q, ['Welcome', 'Start free']);
  assert.equal(captured.body.source, 'en-US');
  assert.equal(captured.body.target, 'de-DE');
  assert.equal(
    captured.body.model,
    'projects/project-id/locations/global/models/general/translation-llm'
  );
  assert.deepEqual(result.map((item) => item.key), ['key.0', 'key.1']);
  assert.deepEqual(result.map((item) => item.value), ['Willkommen', 'Kostenlos starten']);
});

test('Google TLLM OAuth adapter uses Advanced v3 and preserves identity by order', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      translations: [
        { translatedText: 'Willkommen' },
        { translatedText: 'Loslegen' },
      ],
    }), { status: 200 });
  };
  const req = request(fetchImpl);
  const provider = new GoogleTllmProvider({
    accessToken: 'oauth-secret',
    project: 'project-id',
    location: 'us-central1',
    fetch: fetchImpl,
  });
  await provider.translate(req);

  assert.equal(
    captured.url,
    'https://translation.googleapis.com/v3/projects/project-id/locations/us-central1:translateText'
  );
  assert.equal(captured.init.headers.authorization, 'Bearer oauth-secret');
  assert.equal(captured.init.headers['x-goog-user-project'], 'project-id');
  assert.deepEqual(captured.body.contents, ['Welcome', 'Start free']);
  assert.equal(captured.body.mimeType, 'text/plain');
  assert.equal(
    captured.body.model,
    'projects/project-id/locations/us-central1/models/general/translation-llm'
  );
});

test('Google TLLM fails closed on partial provider responses', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    data: { translations: [{ translatedText: 'Only one' }] },
  }), { status: 200 });
  const req = request(fetchImpl);
  const provider = new GoogleTllmProvider({
    apiKey: 'google-secret',
    project: 'project-id',
    fetch: fetchImpl,
  });
  await assert.rejects(provider.translate(req), /returned 1 translation.*expected 2/i);
});
