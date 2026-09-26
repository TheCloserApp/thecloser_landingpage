// POST /api/checkout  { device, plan: "pro" | "pro_max" }  →  { url }
// Starts a Stripe Checkout for this Mac. The fingerprint goes into the
// subscription's metadata, which is what locks the subscription to it.

import { DEVICE_PATTERN, PLANS, SITE_URL } from './_lib/config.js';
import { handle, json, readJSON } from './_lib/http.js';
import { findLiveSubscription, stripe } from './_lib/stripe.js';

export const POST = handle(async (request) => {
  const { device, plan } = await readJSON(request);
  if (!DEVICE_PATTERN.test(device ?? '')) return json(400, { error: 'bad_device' });
  if (!PLANS[plan]) return json(400, { error: 'bad_plan' });

  if (await findLiveSubscription(device)) return json(409, { error: 'already_subscribed' });

  const prices = await stripe().prices.list({ lookup_keys: [PLANS[plan].lookupKey], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) {
    console.error(`No active Stripe price with lookup key ${PLANS[plan].lookupKey}`);
    return json(500, { error: 'price_missing' });
  }

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: device,
    subscription_data: { metadata: { device, plan } },
    success_url: `${SITE_URL}/pro/success`,
    cancel_url: `${SITE_URL}/pro/cancel`,
  });
  return json(200, { url: session.url });
});
