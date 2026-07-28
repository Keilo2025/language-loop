import test from 'node:test';
import assert from 'node:assert/strict';

import { Prompt } from '../dist/core/prompt.js';

/**
 * The multi-select got a resolver so that a 385-language catalogue can be
 * searched instead of printed. These cover the contract that resolver relies
 * on, because the failure mode — a prompt that loops forever, or one that
 * silently swallows a search term as if it were a locale code — is the kind
 * that only shows up in front of a user.
 */
function scripted(answers) {
  const prompt = new Prompt();
  prompt.close();
  const asked = [];
  prompt.rl = {
    question: async () => {
      asked.push(true);
      if (!answers.length) throw new Error('prompt asked more times than the test scripted');
      return answers.shift();
    },
  };
  return { prompt, asked };
}

const CHOICES = [
  { value: 'de-DE', label: 'de-DE German' },
  { value: 'fr-FR', label: 'fr-FR French' },
];

test('numbers and listed codes still resolve, and are deduplicated', async () => {
  const { prompt } = scripted(['1, fr-FR, de-DE']);
  assert.deepEqual(await prompt.multi('q', CHOICES), ['de-DE', 'fr-FR']);
});

test('an empty answer keeps the preselected choices', async () => {
  const { prompt } = scripted(['']);
  const choices = [{ value: 'a', label: 'a', preselected: true }, { value: 'b', label: 'b' }];
  assert.deepEqual(await prompt.multi('q', choices), ['a']);
});

test('a resolver expands a token into several values', async () => {
  const { prompt } = scripted(['africa']);
  const picked = await prompt.multi('q', CHOICES, {
    resolve: (token) => (token === 'africa' ? { values: ['sw-KE', 'yo-NG'] } : null),
  });
  assert.deepEqual(picked, ['sw-KE', 'yo-NG']);
});

test('a search reprompts instead of returning, then accepts the real answer', async () => {
  const { prompt, asked } = scripted(['swahili', 'sw-KE']);
  const picked = await prompt.multi('q', CHOICES, {
    resolve: (token) => (token === 'swahili' ? { reprompt: true } : null),
  });
  assert.deepEqual(picked, ['sw-KE']);
  assert.equal(asked.length, 2, 'should have asked again after the search');
});

test('a search combined with a real pick does not throw the pick away', async () => {
  // Someone types "de-DE, swahili" — the code is a real choice and must survive
  // even though the other token only printed search results.
  const { prompt, asked } = scripted(['de-DE, swahili']);
  const picked = await prompt.multi('q', CHOICES, {
    resolve: (token) => (token === 'swahili' ? { reprompt: true } : null),
  });
  assert.deepEqual(picked, ['de-DE']);
  assert.equal(asked.length, 1);
});

test('an unresolved token is still trusted as an unlisted locale code', async () => {
  const { prompt } = scripted(['gsw-CH']);
  assert.deepEqual(await prompt.multi('q', CHOICES, { resolve: () => null }), ['gsw-CH']);
});
