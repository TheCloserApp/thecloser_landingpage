// GET /api/usage  (Authorization: Bearer <pass>)
//   200 { plan, allowanceUSD, usedUSD, remainingUSD, usedFraction, periodEnd, renews }
//   402 the subscription has ended
// Powers the app's "42% used · Resets Oct 26". The allowance resets on the
// subscriber's billing date, `periodEnd` (Unix seconds). When `renews` is
// false, the subscription ends then instead.

import { env } from './_lib/config.js';
import { bearer, handle, json } from './_lib/http.js';
import { keyStatus } from './_lib/openrouter.js';
import { readPass } from './_lib/pass.js';
import { isLive, planOf, stripe } from './_lib/stripe.js';
import { usageSummary } from './_lib/subscriptions.js';

export const GET = handle(async (request) => {
  const claims = readPass(bearer(request), env('PASS_SECRET'));
  if (!claims) return json(401, { error: 'pass_expired' });
  const [subscription, key] = await Promise.all([
    stripe().subscriptions.retrieve(claims.sub),
    keyStatus(claims.orh),
  ]);
  if (!isLive(subscription) || !planOf(subscription)) return json(402, { error: 'no_subscription' });
  return json(200, usageSummary(subscription, key));
});
