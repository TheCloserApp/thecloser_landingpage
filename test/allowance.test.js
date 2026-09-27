// The allowance follows each subscriber's billing date: checkout creates a
// key capped at one allowance, and each paid renewal adds a fresh one.
// Plays a subscription's life through the real webhook and usage
// endpoints, with Stripe and OpenRouter replaced by in-memory fakes.

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.PASS_SECRET ??= 'test-secret-that-is-long-enough-0123456789abcdef';
process.env.STRIPE_SECRET_KEY = 'unused';
process.env.STRIPE_WEBHOOK_SECRET = 'unused';
process.env.OPENROUTER_MANAGEMENT_KEY = 'unused';

const subscriptions = new Map();
const keys = new Map();

class FakeStripe {
  subscriptions = {
    retrieve: async (id) => structuredClone(subscriptions.get(id)),
    update: async (id, { metadata }) => {
      Object.assign(subscriptions.get(id).metadata, metadata);
      return structuredClone(subscriptions.get(id));
    },
  };
  webhooks = { constructEvent: (body) => JSON.parse(body) };
}
mock.module('stripe', { defaultExport: FakeStripe });

globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname.replace('/api/v1', '');
  const body = init.body ? JSON.parse(init.body) : {};
  if (init.method === 'POST' && path === '/keys') {
    const hash = `hash${keys.size + 1}`;
    keys.set(hash, { usage: 0, limit: body.limit, limit_reset: body.limit_reset ?? null, disabled: body.disabled ?? false });
    return Response.json({ data: { hash }, key: `key-${hash}` });
  }
  const key = keys.get(decodeURIComponent(path.split('/')[2]));
  if (init.method === 'PATCH') Object.assign(key, body);
  return Response.json({ data: { ...key, limit_remaining: key.limit - key.usage } });
};

const { POST: webhook } = await import('../api/stripe-webhook.js');
const { GET: usage } = await import('../api/usage.js');
const { issuePass } = await import('../api/_lib/pass.js');
const { renewedSubscriptionId } = await import('../api/_lib/subscriptions.js');

const deliver = async (type, object) => {
  const response = await webhook(new Request('https://example.test', {
    method: 'POST', body: JSON.stringify({ id: 'evt', type, data: { object } }),
  }));
  assert.equal(response.status, 200, `${type} handled`);
};

const PERIOD_END = 1792000000;
const device = 'a'.repeat(64);
subscriptions.set('sub_1', {
  id: 'sub_1', status: 'active', metadata: { device, plan: 'pro' },
  latest_invoice: { id: 'in_1', status: 'paid', billing_reason: 'subscription_create' },
  cancel_at_period_end: false, cancel_at: null,
  items: { data: [{ price: { lookup_key: 'pro_monthly' }, current_period_start: PERIOD_END - 2500000, current_period_end: PERIOD_END }] },
});
const sub = () => subscriptions.get('sub_1');
const key = () => keys.get(sub().metadata.or_hash);
const renewal = (id) => ({ id, billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_1' } } });

async function checkUsage() {
  const { pass } = issuePass({ sub: 'sub_1', dev: device, plan: 'pro', orh: sub().metadata.or_hash, ork: sub().metadata.or_key }, process.env.PASS_SECRET);
  const response = await usage(new Request('https://example.test', { headers: { authorization: `Bearer ${pass}` } }));
  return { status: response.status, ...(await response.json()) };
}

test('a subscription gets a fresh allowance on each paid renewal, not on the 1st', async () => {
  await deliver('checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', payment_status: 'paid' });
  assert.equal(key().limit, 8);
  assert.equal(key().limit_reset, null, 'OpenRouter never resets it on the calendar');
  assert.equal(sub().metadata.or_base, '0');

  await deliver('invoice.paid', { id: 'in_1', billing_reason: 'subscription_create', parent: { subscription_details: { subscription: 'sub_1' } } });
  assert.equal(key().limit, 8, 'the first invoice adds nothing on top of checkout');

  key().usage = 5.5;
  let shown = await checkUsage();
  assert.deepEqual(shown, { status: 200, plan: 'pro', allowanceUSD: 8, usedUSD: 5.5, remainingUSD: 2.5, usedFraction: 0.6875, periodEnd: PERIOD_END, renews: true });

  key().usage = 8;
  assert.equal((await checkUsage()).remainingUSD, 0, 'capped until the renewal');

  sub().items.data[0].current_period_start = PERIOD_END;
  sub().latest_invoice = { ...renewal('in_2'), status: 'paid' };
  await deliver('invoice.paid', renewal('in_2'));
  assert.equal(key().limit, 16);

  await deliver('invoice.paid', renewal('in_1'));
  assert.equal(key().limit, 16, 'a delayed older invoice cannot refill the current period');
  assert.equal(sub().metadata.or_base, '8');
  assert.equal(sub().metadata.or_period, 'in_2');
  shown = await checkUsage();
  assert.equal(shown.usedUSD, 0);
  assert.equal(shown.remainingUSD, 8);

  key().usage = 9;
  await deliver('invoice.paid', renewal('in_2'));
  assert.equal(sub().metadata.or_base, '8', 'a repeated invoice does not move the period start');
  assert.equal(key().limit, 16);

  await deliver('customer.subscription.updated', { ...structuredClone(sub()), metadata: { ...sub().metadata, or_base: '0' } });
  assert.equal(key().limit, 16, 'an out-of-date event cannot undo the renewal');

  sub().items.data[0].price.lookup_key = 'pro_max_monthly';
  await deliver('customer.subscription.updated', sub());
  assert.equal(key().limit, 28, 'an upgrade applies the Pro Max allowance to this period');
  assert.equal(sub().metadata.plan, 'pro_max');

  sub().status = 'past_due';
  sub().latest_invoice.status = 'open';
  await deliver('invoice.payment_failed', renewal('in_2'));
  assert.equal(key().disabled, true, 'failed payment disables access');
  sub().status = 'active';
  sub().latest_invoice.status = 'paid';
  await deliver('invoice.paid', renewal('in_2'));
  assert.equal(key().disabled, false, 'recovered payment restores access');
  assert.equal(key().limit, 28, 'recovery does not add a second allowance');

  sub().cancel_at_period_end = true;
  assert.equal((await checkUsage()).renews, false, 'the app can say "Ends" instead of "Resets"');

  sub().status = 'canceled';
  await deliver('customer.subscription.deleted', sub());
  assert.equal(key().disabled, true);
  assert.equal((await checkUsage()).status, 402);
});

test('delayed payment provisions only when the invoice is paid, and concurrent events reuse the key', async () => {
  subscriptions.set('sub_delay', {
    id: 'sub_delay', status: 'active', metadata: { device, plan: 'pro' },
    latest_invoice: { id: 'in_delay', status: 'open', billing_reason: 'subscription_create' },
    items: { data: [{ price: { lookup_key: 'pro_monthly' }, current_period_start: PERIOD_END }] },
  });
  const s = subscriptions.get('sub_delay');
  await deliver('checkout.session.completed', { mode: 'subscription', subscription: s.id, payment_status: 'unpaid' });
  assert.equal(s.metadata.or_hash, undefined);
  s.latest_invoice.status = 'paid';
  const count = keys.size;
  await Promise.all([
    deliver('checkout.session.async_payment_succeeded', { mode: 'subscription', subscription: s.id, payment_status: 'paid' }),
    deliver('invoice.paid', { id: 'in_delay', subscription: s.id, status: 'paid' }),
  ]);
  assert.equal(keys.size, count + 1);
  assert.equal(keys.get(s.metadata.or_hash).disabled, false);
  assert.equal(keys.get(s.metadata.or_hash).limit, 8);
});

test('only renewal invoices start a new period', () => {
  const parent = { subscription_details: { subscription: 'sub_9' } };
  assert.equal(renewedSubscriptionId({ billing_reason: 'subscription_cycle', parent }), 'sub_9');
  assert.equal(renewedSubscriptionId({ billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: { id: 'sub_9' } } } }), 'sub_9');
  for (const reason of ['subscription_create', 'subscription_update', 'manual']) {
    assert.equal(renewedSubscriptionId({ billing_reason: reason, parent }), null, reason);
  }
  assert.equal(renewedSubscriptionId({ billing_reason: 'subscription_cycle', parent: null }), null);
});
