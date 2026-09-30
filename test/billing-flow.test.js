import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

process.env.STRIPE_SECRET_KEY = 'unused';
process.env.PASS_SECRET = 'billing-flow-secret-not-for-production';
const device = 'a'.repeat(64);
let subs, sessions, created, expired, portalCalls, searchResults;
const price = (plan) => ({ id: `price_${plan}`, type: 'recurring', unit_amount: 100, currency: 'usd', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } });
const iterate = (items) => ({ async *[Symbol.asyncIterator]() { yield* items; } });
class FakeStripe {
  prices = { list: async ({ lookup_keys }) => ({ data: [price(lookup_keys[0])] }) };
  customers = { search: async () => ({ data: [{ id: 'cus_1' }] }) };
  subscriptions = {
    search: async () => ({ data: searchResults, has_more: false }),
    list: () => iterate([...subs.values()]),
    retrieve: async (id) => structuredClone(subs.get(id)),
    update: async (id, { metadata }) => { Object.assign(subs.get(id).metadata, metadata); return structuredClone(subs.get(id)); },
  };
  checkout = { sessions: {
    list: () => iterate([...sessions.values()].filter(s => s.status === 'open')),
    create: async (args, options) => {
      created.push({ args, options });
      const s = { ...args, id: 'cs_test_new', status: 'open', url: 'https://checkout.stripe.com/c/pay/test' };
      sessions.set(s.id, s); return s;
    },
    retrieve: async (id) => structuredClone(sessions.get(id)),
    expire: async (id) => { expired.push(id); sessions.get(id).status = 'expired'; },
  } };
  billingPortal = { sessions: { create: async (args) => { portalCalls.push(args); return { url: 'https://billing.stripe.com/p/session/test' }; } } };
}
mock.module('stripe', { defaultExport: FakeStripe });
mock.module('../api/_lib/openrouter.js', { namedExports: {
  createKey: async () => ({ hash: 'hash', key: 'never-leave-server' }),
  updateKey: async () => {}, keyStatus: async () => ({ totalUsageUSD: 0, remainingUSD: 8 }),
} });
const { POST: checkout } = await import('../api/checkout.js');
const { POST: pass } = await import('../api/pass.js');
const { POST: portal } = await import('../api/portal.js');
const { GET: plans } = await import('../api/plans.js');
const { issuePass, readPass } = await import('../api/_lib/pass.js');
const post = (data, token) => new Request('https://example.test', { method: 'POST', body: JSON.stringify(data), headers: token ? { authorization: `Bearer ${token}` } : {} });
const subscription = (status = 'active') => ({ id: 'sub_1', status, customer: 'cus_1', metadata: { device, plan: 'pro', or_hash: 'hash', or_key: 'encrypted' }, latest_invoice: { id: 'in_1', status: 'paid', billing_reason: 'subscription_create' }, items: { data: [{ current_period_start: 1790000000, price: { lookup_key: 'pro_monthly' } }] } });
beforeEach(() => { subs = new Map(); sessions = new Map(); created = []; expired = []; portalCalls = []; searchResults = []; });

test('Windows reads the existing Mac catalog prices without creating products', async () => {
  const result = await (await plans()).json();
  assert.deepEqual(Object.keys(result.plans), ['pro', 'pro_max']);
  assert.deepEqual(result.plans.pro.price, { unitAmount: 100, currency: 'usd', interval: 'month', intervalCount: 1 });
  assert.equal(result.plans.pro_max.price.unitAmount, 100);
});

test('checkout uses the existing recurring price and reuses a double-clicked session', async () => {
  const body = { device, plan: 'pro', requestId: 'one-attempt-123456' };
  const responses = await Promise.all([checkout(post(body)), checkout(post(body))]);
  assert.deepEqual(await responses[0].json(), { url: 'https://checkout.stripe.com/c/pay/test', sessionId: 'cs_test_new' });
  assert.deepEqual(await responses[1].json(), { url: 'https://checkout.stripe.com/c/pay/test', sessionId: 'cs_test_new' });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].args.line_items, [{ price: 'price_pro_monthly1', quantity: 1 }]);
  assert.deepEqual(created[0].args.subscription_data.metadata, { device, plan: 'pro' });
  assert.equal(created[0].args.mode, 'subscription');
  assert.match(created[0].options.idempotencyKey, /^[a-f0-9]{64}$/);
});

test('changing plans expires the earlier unpaid Checkout session', async () => {
  sessions.set('cs_test_old', { id: 'cs_test_old', mode: 'subscription', status: 'open', client_reference_id: device, metadata: { plan: 'pro', price: 'price_pro_monthly1' }, url: 'https://checkout.stripe.com/old' });
  assert.equal((await checkout(post({ device, plan: 'pro_max' }))).status, 200);
  assert.deepEqual(expired, ['cs_test_old']);
  assert.equal(created[0].args.line_items[0].price, 'price_pro_max_monthly1');
});

test('a past-due or active subscription blocks a second purchase even during Stripe search lag', async () => {
  for (const status of ['active', 'past_due', 'unpaid', 'incomplete']) {
    subs.set('sub_1', subscription(status));
    assert.equal((await checkout(post({ device, plan: 'pro' }))).status, 409, status);
  }
  assert.equal(created.length, 0);
});

test('exact Checkout session activates a paid subscription while Stripe search is still empty', async () => {
  subs.set('sub_1', subscription());
  sessions.set('cs_test_paid12345', { id: 'cs_test_paid12345', mode: 'subscription', client_reference_id: device, status: 'complete', payment_status: 'paid', subscription: 'sub_1' });
  const response = await pass(post({ device, checkoutSessionId: 'cs_test_paid12345' }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(readPass(result.pass, process.env.PASS_SECRET).sub, 'sub_1');
  assert.equal(result.plan, 'pro');
  assert.equal(result.allowanceUSD, 8);
});

test('unpaid, expired and foreign Checkout sessions do not grant access', async () => {
  sessions.set('cs_test_pending12345', { mode: 'subscription', client_reference_id: device, status: 'complete', payment_status: 'unpaid', subscription: 'sub_1' });
  let result = await pass(post({ device, checkoutSessionId: 'cs_test_pending12345' }));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error, 'payment_pending');
  sessions.get('cs_test_pending12345').status = 'expired';
  result = await pass(post({ device, checkoutSessionId: 'cs_test_pending12345' }));
  assert.equal((await result.json()).error, 'checkout_expired');
  sessions.get('cs_test_pending12345').client_reference_id = 'b'.repeat(64);
  assert.equal((await pass(post({ device, checkoutSessionId: 'cs_test_pending12345' }))).status, 400);
});

test('a previously active subscription with an unpaid invoice cannot renew its AI pass', async () => {
  const s = subscription(); s.latest_invoice.status = 'open'; subs.set(s.id, s); searchResults = [s];
  const response = await pass(post({ device }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'payment_pending');
});

test('billing recovery accepts an expired signed pass only with the matching device', async () => {
  subs.set('sub_1', subscription('past_due'));
  const { pass: token } = issuePass({ sub: 'sub_1', dev: device, plan: 'pro' }, process.env.PASS_SECRET, 1000);
  assert.equal((await portal(post({ device }, token))).status, 200);
  assert.equal(portalCalls[0].customer, 'cus_1');
  assert.equal((await portal(post({}, token))).status, 401);
  assert.equal((await portal(post({ device: 'b'.repeat(64) }, token))).status, 401);
  subs.get('sub_1').metadata.device = 'b'.repeat(64);
  assert.equal((await portal(post({ device }, token))).status, 401);
  assert.equal(portalCalls.length, 1);
});
