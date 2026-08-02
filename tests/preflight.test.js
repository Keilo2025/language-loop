import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleTllmProvider } from '../dist/core/providers/google-tllm.js';
import { OpenAiJudgeProvider } from '../dist/core/providers/openai-judge.js';
import { defaultConfig } from '../dist/core/config.js';

const ENV_KEYS = [
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_TRANSLATION_API_KEY',
  'GOOGLE_CLOUD_ACCESS_TOKEN',
  'OPENAI_API_KEY',
];

function config(over = {}) {
  return {
    ...defaultConfig({
      framework: 'next-app', runtime: 'next-intl', messagesDir: 'messages',
      layout: 'single-file', srcDir: 'app', runtimeInstalled: true, evidence: [],
    }),
    ...over,
  };
}

// The developer's real shell may export provider keys; every test runs
// against a scrubbed environment and the originals are restored afterwards.
function withoutEnv(t) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test('google-tllm reports project and credentials problems when nothing is set', (t) => {
  withoutEnv(t);
  const problems = new GoogleTllmProvider().checkRequirements(config());
  assert.equal(problems.length, 2);
  assert.match(problems[0], /GOOGLE_CLOUD_PROJECT/);
  assert.match(problems[0], /ai\.google\.project/);
  assert.match(problems[1], /GOOGLE_CLOUD_TRANSLATION_API_KEY/);
  assert.match(problems[1], /GOOGLE_CLOUD_ACCESS_TOKEN/);
});

test('google-tllm passes with project from config and key from env', (t) => {
  withoutEnv(t);
  process.env.GOOGLE_CLOUD_TRANSLATION_API_KEY = 'AIza-test';
  const cfg = config();
  cfg.ai.google.project = 'my-project';
  assert.deepEqual(new GoogleTllmProvider().checkRequirements(cfg), []);
});

test('google-tllm accepts an access token instead of an API key', (t) => {
  withoutEnv(t);
  process.env.GOOGLE_CLOUD_PROJECT = 'my-project';
  process.env.GOOGLE_CLOUD_ACCESS_TOKEN = 'ya29.test';
  assert.deepEqual(new GoogleTllmProvider().checkRequirements(config()), []);
});

test('google-tllm constructor options satisfy every requirement', (t) => {
  withoutEnv(t);
  const provider = new GoogleTllmProvider({ project: 'p', apiKey: 'k' });
  assert.deepEqual(provider.checkRequirements(config()), []);
});

test('openai judge reports a missing key with where to create one', (t) => {
  withoutEnv(t);
  const problems = new OpenAiJudgeProvider().checkRequirements(config());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /OPENAI_API_KEY/);
  assert.match(problems[0], /platform\.openai\.com/);
});

test('openai judge passes with a key from env or options', (t) => {
  withoutEnv(t);
  process.env.OPENAI_API_KEY = 'sk-test';
  assert.deepEqual(new OpenAiJudgeProvider().checkRequirements(config()), []);
  delete process.env.OPENAI_API_KEY;
  assert.deepEqual(new OpenAiJudgeProvider({ apiKey: 'sk-opt' }).checkRequirements(config()), []);
});
