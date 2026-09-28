// GET /api/usage  (Authorization: Bearer <pass>)
//   200 { plan, allowanceUSD, usedUSD, remainingUSD, usedFraction, periodEnd, renews }
//   402 the subscription has ended
// Powers the app's "42% used · Resets Oct 26". The allowance resets on the
// subscriber's billing date, `periodEnd` (Unix seconds). When `renews` is
// false, the subscription ends then instead. For a tester it's the shared
// test budget (`tester: true`, `periodEnd: null`).

import { env } from './_lib/config.js';
import { bearer, handle, json } from './_lib/http.js';
import { keyStatus } from './_lib/openrouter.js';
import { decryptSecret, readPass } from './_lib/pass.js';
import { isLive, planOf, stripe } from './_lib/stripe.js';
import { usageSummary } from './_lib/subscriptions.js';
import { testerKeyStatus, testerProgram, testerUsage } from './_lib/testers.js';

export const GET = handle(async (request) => {
  const secret = env('PASS_SECRET');
  const claims = readPass(bearer(request), secret);
  if (!claims) return json(401, { error: 'pass_expired' });
  if (claims.tst) {
    if (!testerProgram()) return json(402, { error: 'no_subscription' });
    const status = await testerKeyStatus(decryptSecret(claims.ork, secret));
    if (status.limitUSD === null) return json(503, { error: 'tester_budget_not_set' });
    return json(200, testerUsage(status));
  }
  const [subscription, key] = await Promise.all([
    stripe().subscriptions.retrieve(claims.sub),
    keyStatus(claims.orh),
  ]);
  if (!isLive(subscription) || !planOf(subscription)) return json(402, { error: 'no_subscription' });
  return json(200, usageSummary(subscription, key));
});
