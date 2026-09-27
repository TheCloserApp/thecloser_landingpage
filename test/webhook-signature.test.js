import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe from 'stripe';
import { POST } from '../api/stripe-webhook.js';
process.env.STRIPE_SECRET_KEY = 'sk_test_unused';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_offline_test';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const payload = JSON.stringify({ id: 'evt_test', type: 'unhandled.test', data: { object: {} } });
const request = (body, signature) => new Request('https://example.test', { method: 'POST', body, headers: { 'stripe-signature': signature } });
test('webhook verifies the unmodified raw body and rejects tampering', async () => {
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  assert.equal((await POST(request(payload, signature))).status, 200);
  assert.equal((await POST(request(payload + ' ', signature))).status, 400);
  assert.equal((await POST(request(payload, 'forged'))).status, 400);
});
