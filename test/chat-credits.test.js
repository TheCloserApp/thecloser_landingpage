// /api/chat tells two 402s apart: the subscriber's own allowance is used up
// (passed through, the app says so), or TheCloser's OpenRouter account is out
// of credit (a 503 "try again", logged for us). OpenRouter is a fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PASS_SECRET ??= 'test-secret-that-is-long-enough-0123456789abcdef';

let reply;
globalThis.fetch = async () => reply();

const { POST: chat, isAccountOutOfCredit } = await import('../api/chat.js');
const { encryptSecret, issuePass } = await import('../api/_lib/pass.js');

const device = 'c'.repeat(64);
const { pass } = issuePass({ sub: 's', dev: device, plan: 'pro', orh: 'h', ork: encryptSecret('subscriber-key', process.env.PASS_SECRET) }, process.env.PASS_SECRET);
const ask = () => chat(new Request('https://example.test', {
  method: 'POST',
  headers: { authorization: `Bearer ${pass}`, 'x-device': device },
  body: JSON.stringify({ model: 'anthropic/claude-sonnet-5', messages: [] }),
}));
const openRouter402 = (limitSource) => () => Response.json({
  error: { code: 402, message: 'This request requires more credits, or fewer max_tokens.', metadata: { limit_source: limitSource } },
}, { status: 402 });

test("our OpenRouter account out of credit is a 503 'try again', not the subscriber's allowance", async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (message) => logged.push(message));
  reply = openRouter402('openrouter_credits');
  const response = await ask();
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Try again in a moment/);
  assert.match(logged.join(' '), /out of credit/);
});

test("the subscriber's own key limit still comes back as 402", async () => {
  reply = openRouter402('key');
  const response = await ask();
  assert.equal(response.status, 402);
  assert.equal((await response.json()).error.metadata.limit_source, 'key');
});

test('recognizing the account case', () => {
  assert.equal(isAccountOutOfCredit(JSON.stringify({ error: { metadata: { limit_source: 'openrouter_credits' } } })), true);
  assert.equal(isAccountOutOfCredit(JSON.stringify({ error: { metadata: { limit_source: 'key' } } })), false);
  assert.equal(isAccountOutOfCredit('not json'), false);
});
