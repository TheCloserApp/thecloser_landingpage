// POST /api/checkout { device, plan, requestId? } -> { url, sessionId }
import { createHash } from 'node:crypto';
import { DEVICE_PATTERN, SITE_URL, isPlan } from './_lib/config.js';
import { handle, json, readJSON } from './_lib/http.js';
import { serial } from './_lib/serial.js';
import { activePrice, checkoutCustomer, findSubscription, isExisting, objectId, stripe } from './_lib/stripe.js';

export const POST = handle(async (request) => {
  const { device, plan, requestId } = await readJSON(request);
  if (typeof device !== 'string' || !DEVICE_PATTERN.test(device)) return json(400, { error: 'bad_device' });
  if (!isPlan(plan)) return json(400, { error: 'bad_plan' });
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId))) {
    return json(400, { error: 'bad_request_id' });
  }
  return serial(`checkout:${device}`, async () => {
    if (await findSubscription(device)) return json(409, { error: 'already_subscribed' });
    const price = await activePrice(plan);
    if (!price) return json(500, { error: 'price_missing' });
    const customer = await checkoutCustomer(device);
    // List-by-customer does not depend on the eventually consistent search index.
    for await (const subscription of stripe().subscriptions.list({ customer: customer.id, status: 'all', limit: 100 })) {
      if (isExisting(subscription)) return json(409, { error: 'already_subscribed' });
    }
    for await (const session of stripe().checkout.sessions.list({ customer: customer.id, status: 'open', limit: 100 })) {
      if (session.client_reference_id !== device || session.mode !== 'subscription') continue;
      if (session.metadata?.plan === plan && session.metadata?.price === price.id && session.url) {
        return json(200, { url: session.url, sessionId: session.id });
      }
      // Switching plans must not leave a second payable checkout behind.
      await stripe().checkout.sessions.expire(session.id);
    }
    const attempt = requestId ?? String(Math.floor(Date.now() / (30 * 60 * 1000)));
    const idempotencyKey = createHash('sha256').update(`checkout-v1:${device}:${plan}:${attempt}`).digest('hex');
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription', customer: customer.id,
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: device,
      metadata: { device, plan, price: price.id },
      subscription_data: { metadata: { device, plan } },
      success_url: `${SITE_URL}/pro/success`, cancel_url: `${SITE_URL}/pro/cancel`,
    }, { idempotencyKey });
    // Idempotency can return the initial copy of a now-complete/expired session.
    const current = await stripe().checkout.sessions.retrieve(session.id);
    if (current.status === 'complete' || objectId(current.subscription)) return json(409, { error: 'already_subscribed' });
    if (current.status !== 'open' || !current.url) return json(409, { error: 'checkout_expired' });
    return json(200, { url: current.url, sessionId: current.id });
  });
});
