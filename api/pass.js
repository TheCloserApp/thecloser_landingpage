// POST /api/pass  { device, pass? }
//   200 { pass, expiresAt, plan, allowanceUSD, models }
//   402 no live subscription for this Mac
//   409 subscription found but its AI key isn't set up yet (retry shortly)
//
// The app calls this at launch and about once an hour. Sending the
// previous pass lets the server look the subscription up by id (instant)
// instead of searching (which can lag a minute behind checkout).

import { DEVICE_PATTERN, PLANS, env } from './_lib/config.js';
import { handle, json, readJSON } from './_lib/http.js';
import { issuePass, readPass } from './_lib/pass.js';
import { findLiveSubscription, isLive, planOf, stripe } from './_lib/stripe.js';

export const POST = handle(async (request) => {
  const { device, pass } = await readJSON(request);
  if (!DEVICE_PATTERN.test(device ?? '')) return json(400, { error: 'bad_device' });
  const secret = env('PASS_SECRET');

  const usable = (subscription) => isLive(subscription) && subscription.metadata?.device === device;

  let subscription = null;
  const previous = readPass(pass, secret, { allowExpired: true });
  if (previous?.sub && previous.dev === device) {
    subscription = await stripe().subscriptions.retrieve(previous.sub).catch(() => null);
  }
  // A cancelled old subscription doesn't rule out a newer one on this Mac.
  if (!usable(subscription)) subscription = await findLiveSubscription(device);
  if (!usable(subscription)) return json(402, { error: 'no_subscription' });

  const plan = planOf(subscription);
  if (!plan) return json(500, { error: 'unknown_plan' });
  const { or_hash: keyHash, or_key: encryptedKey } = subscription.metadata;
  if (!keyHash || !encryptedKey) return json(409, { error: 'setting_up' });

  const issued = issuePass({ sub: subscription.id, dev: device, plan, orh: keyHash, ork: encryptedKey }, secret);
  return json(200, { ...issued, plan, allowanceUSD: PLANS[plan].allowanceUSD, models: PLANS[plan].models });
});
