// POST /api/portal  (Authorization: Bearer <pass>)  →  { url }
// Opens Stripe's customer portal for this subscription (cancel, change
// plan, update card) straight from the app, with no email sign-in. The
// portal must be switched on once in Stripe: Settings → Billing →
// Customer portal.

import { DEVICE_PATTERN, SITE_URL, env } from './_lib/config.js';
import { bearer, handle, json, readJSON } from './_lib/http.js';
import { readPass } from './_lib/pass.js';
import { stripe } from './_lib/stripe.js';

export const POST = handle(async (request) => {
  const { device } = await readJSON(request);
  // A current pass preserves the Mac contract. Expired passes can only open
  // billing recovery when the device credential still matches Stripe.
  const token = bearer(request);
  const secret = env('PASS_SECRET');
  const current = readPass(token, secret);
  const claims = current ?? readPass(token, secret, { allowExpired: true });
  if (!claims) return json(401, { error: 'pass_expired' });
  if (claims.tst) return json(409, { error: 'tester_access' });
  const subscription = await stripe().subscriptions.retrieve(claims.sub);
  if (subscription.metadata?.device !== claims.dev) return json(401, { error: 'wrong_device' });
  if ((!current || device !== undefined) && (typeof device !== 'string' || !DEVICE_PATTERN.test(device) || device !== claims.dev)) {
    return json(401, { error: 'wrong_device' });
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: subscription.customer,
    return_url: SITE_URL,
  });
  return json(200, { url: session.url });
});
