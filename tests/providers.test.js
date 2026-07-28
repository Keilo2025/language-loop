import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderRegistry,
  requestJson,
} from '../dist/core/providers.js';

test('provider contract keeps translator and judge adapters separate', () => {
  const registry = new ProviderRegistry();
  registry.registerTranslator({ id: 'translator-a', translate: async () => [] });
  registry.registerJudge({ id: 'judge-a', judge: async () => [] });

  assert.equal(registry.translator('translator-a').id, 'translator-a');
  assert.equal(registry.judge('judge-a').id, 'judge-a');
  assert.throws(() => registry.judge('translator-a'), /judge.*judge-a/i);
  assert.throws(() => registry.translator('missing'), /translator.*translator-a/i);
});

test('provider contract retries transient responses only to the configured ceiling', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3) return new Response('busy', { status: 503 });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await requestJson('https://provider.invalid/test', {
    method: 'POST',
    headers: { authorization: 'Bearer hidden-token' },
  }, {
    fetch: fetchImpl,
    timeoutMs: 1_000,
    transientRetries: 2,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    requestJson('https://provider.invalid/test', {}, {
      fetch: async () => {
        calls++;
        return new Response('bad input', { status: 400 });
      },
      timeoutMs: 1_000,
      transientRetries: 5,
    }),
    /400.*bad input/i
  );
  assert.equal(calls, 1);
});

test('provider contract aborts timed-out requests and redacts authorization data', async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  await assert.rejects(
    requestJson('https://provider.invalid/test?key=visible-secret', {
      headers: { authorization: 'Bearer visible-secret' },
    }, {
      fetch: fetchImpl,
      timeoutMs: 10,
      transientRetries: 0,
    }),
    (error) => {
      assert.match(error.message, /timed out/i);
      assert.doesNotMatch(error.message, /visible-secret/);
      return true;
    }
  );
});

test('provider contract does not retry a successful HTTP response with malformed JSON', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson('https://provider.invalid/test', {}, {
      fetch: async () => {
        calls++;
        return new Response('not-json', { status: 200 });
      },
      timeoutMs: 1_000,
      transientRetries: 5,
    }),
    /invalid JSON/i
  );
  assert.equal(calls, 1);
});
