// Every endpoint module loads, exports the right method, and answers bad
// input or a missing pass without calling Stripe or OpenRouter.

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PASS_SECRET ??= 'test-secret-that-is-long-enough-0123456789abcdef';

const post = (body, headers = {}) =>
  new Request('https://example.test', { method: 'POST', body: JSON.stringify(body), headers });

test('each endpoint exports its HTTP method', async () => {
  const expected = { checkout: 'POST', 'stripe-webhook': 'POST', pass: 'POST', chat: 'POST', usage: 'GET', portal: 'POST', models: 'GET', 'model-request': 'POST' };
  for (const [file, method] of Object.entries(expected)) {
    const module = await import(`../api/${file}.js`);
    assert.equal(typeof module[method], 'function', `${file} exports ${method}`);
  }
});

test('checkout and pass reject a malformed device before touching Stripe', async () => {
  const { POST: checkout } = await import('../api/checkout.js');
  const { POST: pass } = await import('../api/pass.js');
  assert.equal((await checkout(post({ device: 'nope', plan: 'pro' }))).status, 400);
  assert.equal((await pass(post({ device: "x' OR 1" }))).status, 400);
});

test('chat, usage and portal refuse requests without a valid pass', async () => {
  const { POST: chat } = await import('../api/chat.js');
  const { GET: usage } = await import('../api/usage.js');
  const { POST: portal } = await import('../api/portal.js');
  assert.equal((await chat(post({ model: 'x' }, { authorization: 'Bearer forged.pass' }))).status, 401);
  assert.equal((await usage(new Request('https://example.test'))).status, 401);
  assert.equal((await portal(post({}))).status, 401);
});

test('chat refuses a model outside the plan', async () => {
  const { issuePass } = await import('../api/_lib/pass.js');
  const { POST: chat } = await import('../api/chat.js');
  const device = 'a'.repeat(64);
  const { pass } = issuePass({ sub: 's', dev: device, plan: 'pro', orh: 'h', ork: 'k' }, process.env.PASS_SECRET);
  const response = await chat(post({ model: 'anthropic/claude-opus-5.5' }, { authorization: `Bearer ${pass}`, 'x-device': device }));
  assert.equal(response.status, 403);
  const wrongDevice = await chat(post({ model: 'anthropic/claude-sonnet-5' }, { authorization: `Bearer ${pass}`, 'x-device': 'b'.repeat(64) }));
  assert.equal(wrongDevice.status, 401);
});

test('models lists both plans', async () => {
  const { GET } = await import('../api/models.js');
  const { plans } = await (await GET()).json();
  assert.deepEqual(Object.keys(plans), ['pro', 'pro_max']);
});

test('failures name the missing setting or Stripe error type, never secrets', async () => {
  const { describeFailure } = await import('../api/_lib/http.js');
  const { ConfigError } = await import('../api/_lib/config.js');
  assert.deepEqual(describeFailure(new ConfigError('STRIPE_SECRET_KEY')), { error: 'not_configured', setting: 'STRIPE_SECRET_KEY' });
  const stripeError = Object.assign(new Error('Invalid API Key provided: sk_live_****1234'), { type: 'StripeAuthenticationError', code: undefined });
  const described = describeFailure(stripeError);
  assert.deepEqual(described, { error: 'stripe_error', type: 'StripeAuthenticationError', code: null });
  assert.ok(!JSON.stringify(described).includes('sk_live'));
  assert.deepEqual(describeFailure(new Error('boom')), { error: 'server_error' });
});
