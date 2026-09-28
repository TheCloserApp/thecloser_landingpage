// Tester access: the tester code gives Pro paid from one shared key whose
// OpenRouter credit limit caps all testers together. Stripe and OpenRouter
// are replaced by fakes.

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.PASS_SECRET ??= 'test-secret-that-is-long-enough-0123456789abcdef';
process.env.STRIPE_SECRET_KEY = 'unused';
// Assembled at runtime: a literal key-shaped string trips GitHub's secret scanning.
const SHARED_KEY = ['sk-or-v1', 't'.repeat(64)].join('-');
const CODE = 'Closer-Test-2026';

const subscriptions = new Map();   // device → subscription
let sharedKey = { limit: 5, usage: 1.25, limit_remaining: 3.75 };

class FakeStripe {
  subscriptions = {
    search: async ({ query }) => {
      const device = query.match(/'([a-f0-9]{64})'/)[1];
      return { data: subscriptions.has(device) ? [subscriptions.get(device)] : [], has_more: false };
    },
    retrieve: async (id) => [...subscriptions.values()].find((s) => s.id === id) ?? Promise.reject(new Error('missing')),
  };
  invoices = { retrieve: async () => ({ status: 'paid' }) };
}
mock.module('stripe', { defaultExport: FakeStripe });

const openRouterCalls = [];
globalThis.fetch = async (url, init = {}) => {
  openRouterCalls.push({ url: String(url), auth: init.headers?.Authorization });
  return Response.json({ data: sharedKey });
};

const { POST: pass } = await import('../api/pass.js');
const { GET: usage } = await import('../api/usage.js');
const { POST: portal } = await import('../api/portal.js');
const { POST: upgrade } = await import('../api/upgrade.js');
const { readPass, decryptSecret } = await import('../api/_lib/pass.js');

const device = 'b'.repeat(64);
const post = (body) => pass(new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) }));
const withTesting = (on) => {
  if (on) { process.env.TESTER_CODE = CODE; process.env.TESTER_OPENROUTER_KEY = SHARED_KEY; }
  else { delete process.env.TESTER_CODE; delete process.env.TESTER_OPENROUTER_KEY; }
};

test('the tester code gives Pro on the shared key', async () => {
  withTesting(true);
  const response = await post({ device, code: '  closer test 2026 ' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tester, true);
  assert.equal(body.plan, 'pro');
  const claims = readPass(body.pass, process.env.PASS_SECRET);
  assert.equal(claims.tst, 1);
  assert.equal(claims.dev, device);
  assert.equal(decryptSecret(claims.ork, process.env.PASS_SECRET), SHARED_KEY, 'chat will use the shared key');
  assert.equal(openRouterCalls.at(-1).auth, `Bearer ${SHARED_KEY}`, 'the credit limit was checked');
});

test('a wrong code, or testing turned off, is refused', async () => {
  withTesting(true);
  assert.equal((await post({ device, code: 'nope' })).status, 403);
  assert.equal((await post({ device, code: '' })).status, 403);
  withTesting(false);
  assert.equal((await post({ device, code: CODE })).status, 403);
});

test('a shared key without a credit limit is never used', async () => {
  withTesting(true);
  sharedKey = { limit: null, usage: 0, limit_remaining: null };
  assert.equal((await post({ device, code: CODE })).status, 503);
  sharedKey = { limit: 5, usage: 1.25, limit_remaining: 3.75 };
});

test('a tester pass renews while testing runs, and stops when it ends', async () => {
  withTesting(true);
  const first = await (await post({ device, code: CODE })).json();
  const renewed = await post({ device, pass: first.pass });
  assert.equal(renewed.status, 200);
  assert.equal((await renewed.json()).tester, true);
  withTesting(false);
  assert.equal((await post({ device, pass: first.pass })).status, 402);
});

test('another device cannot renew a tester pass', async () => {
  withTesting(true);
  const first = await (await post({ device, code: CODE })).json();
  assert.equal((await post({ device: 'c'.repeat(64), pass: first.pass })).status, 402);
});

test('a tester who subscribes gets the subscription instead', async () => {
  withTesting(true);
  const first = await (await post({ device, code: CODE })).json();
  subscriptions.set(device, {
    id: 'sub_tester', status: 'active', latest_invoice: 'in_1',
    metadata: { device, plan: 'pro_max', or_hash: 'h', or_key: 'k' },
    items: { data: [{ price: { lookup_key: 'pro_max_monthly' } }] },
  });
  const body = await (await post({ device, pass: first.pass })).json();
  assert.equal(body.tester, undefined);
  assert.equal(body.plan, 'pro_max');
  subscriptions.delete(device);
});

test('usage shows the shared budget; billing pages are closed to testers', async () => {
  withTesting(true);
  const { pass: token } = await (await post({ device, code: CODE })).json();
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const shown = await (await usage(new Request('https://example.test', auth))).json();
  assert.deepEqual(shown, {
    plan: 'pro', tester: true, allowanceUSD: 5, usedUSD: 1.25, remainingUSD: 3.75,
    usedFraction: 0.25, periodEnd: null, renews: false,
  });
  const postAuth = { method: 'POST', body: '{}', headers: { authorization: `Bearer ${token}` } };
  assert.equal((await portal(new Request('https://example.test', postAuth))).status, 409);
  assert.equal((await upgrade(new Request('https://example.test', postAuth))).status, 409);
});
