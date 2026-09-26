// Pro → Pro Max opens Stripe's confirmation page for exactly that switch.
// Stripe is replaced by a fake that records what it was asked for.

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.PASS_SECRET ??= 'test-secret-that-is-long-enough-0123456789abcdef';
process.env.STRIPE_SECRET_KEY = 'unused';

const subscriptions = new Map();
const portalSessions = [];

class FakeStripe {
  subscriptions = { retrieve: async (id) => structuredClone(subscriptions.get(id)) };
  prices = {
    list: async ({ lookup_keys }) => ({ data: lookup_keys[0] === 'pro_max_monthly' ? [{ id: 'price_max' }] : [] }),
  };
  billingPortal = {
    sessions: {
      create: async (params) => {
        portalSessions.push(params);
        return { url: 'https://billing.stripe.com/p/session/test' };
      },
    },
  };
}
mock.module('stripe', { defaultExport: FakeStripe });

const { POST } = await import('../api/upgrade.js');
const { issuePass } = await import('../api/_lib/pass.js');

const subscription = (id, lookupKey, status = 'active') => ({
  id, status, customer: `cus_${id}`,
  items: { data: [{ id: `si_${id}`, price: { lookup_key: lookupKey } }] },
});
const upgrade = (sub) => {
  const { pass } = issuePass({ sub, dev: 'a'.repeat(64), plan: 'pro', orh: 'h', ork: 'k' }, process.env.PASS_SECRET);
  return POST(new Request('https://example.test', { method: 'POST', headers: { authorization: `Bearer ${pass}` } }));
};

test('a Pro subscriber gets a confirmation page for Pro Max', async () => {
  subscriptions.set('sub_pro', subscription('sub_pro', 'pro_monthly'));
  const response = await upgrade('sub_pro');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'https://billing.stripe.com/p/session/test');
  const [params] = portalSessions;
  assert.equal(params.customer, 'cus_sub_pro');
  assert.equal(params.flow_data.type, 'subscription_update_confirm');
  assert.deepEqual(params.flow_data.subscription_update_confirm, {
    subscription: 'sub_pro',
    items: [{ id: 'si_sub_pro', price: 'price_max', quantity: 1 }],
  });
});

test('Pro Max, ended subscriptions and missing passes are refused', async () => {
  subscriptions.set('sub_max', subscription('sub_max', 'pro_max_monthly'));
  subscriptions.set('sub_gone', subscription('sub_gone', 'pro_monthly', 'canceled'));
  assert.equal((await upgrade('sub_max')).status, 409);
  assert.equal((await upgrade('sub_gone')).status, 402);
  const noPass = await POST(new Request('https://example.test', { method: 'POST' }));
  assert.equal(noPass.status, 401);
});
