// POST /api/upgrade  (Authorization: Bearer <pass>)  →  { url }
// Pro → Pro Max from the app. Opens Stripe's page confirming the switch
// and its prorated charge, so the new price is approved on Stripe, not in
// our app. The webhook then raises the key's cap and the app picks up the
// new plan on its next pass. Needs "customers can switch plans" in
// Stripe's customer portal settings.

import { SITE_URL, env } from './_lib/config.js';
import { bearer, handle, json } from './_lib/http.js';
import { readPass } from './_lib/pass.js';
import { activePrice, isLive, planOf, stripe } from './_lib/stripe.js';

export const POST = handle(async (request) => {
  // A current pass only: the page shows the subscriber's card.
  const claims = readPass(bearer(request), env('PASS_SECRET'));
  if (!claims) return json(401, { error: 'pass_expired' });
  const subscription = await stripe().subscriptions.retrieve(claims.sub);
  if (!isLive(subscription)) return json(402, { error: 'no_subscription' });
  if (planOf(subscription) === 'pro_max') return json(409, { error: 'already_pro_max' });

  const price = await activePrice('pro_max');
  if (!price) return json(500, { error: 'price_missing' });

  const session = await stripe().billingPortal.sessions.create({
    customer: subscription.customer,
    return_url: SITE_URL,
    flow_data: {
      type: 'subscription_update_confirm',
      subscription_update_confirm: {
        subscription: subscription.id,
        items: [{ id: subscription.items.data[0].id, price: price.id, quantity: 1 }],
      },
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: { custom_message: "You're on Pro Max. TheCloser switches over within a minute." },
      },
    },
  });
  return json(200, { url: session.url });
});
