// POST /api/portal  (Authorization: Bearer <pass>)  →  { url }
// Opens Stripe's customer portal for this subscription (cancel, change
// plan, update card) straight from the app, with no email sign-in. The
// portal must be switched on once in Stripe: Settings → Billing →
// Customer portal.

import { SITE_URL, env } from './_lib/config.js';
import { bearer, handle, json } from './_lib/http.js';
import { readPass } from './_lib/pass.js';
import { stripe } from './_lib/stripe.js';

export const POST = handle(async (request) => {
  // A current pass only: the portal shows the subscriber's email and card.
  const claims = readPass(bearer(request), env('PASS_SECRET'));
  if (!claims) return json(401, { error: 'pass_expired' });
  const subscription = await stripe().subscriptions.retrieve(claims.sub);
  const session = await stripe().billingPortal.sessions.create({
    customer: subscription.customer,
    return_url: SITE_URL,
  });
  return json(200, { url: session.url });
});
