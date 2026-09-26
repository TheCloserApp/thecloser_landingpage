// Keeps each subscriber's OpenRouter key in step with their Stripe
// subscription. Stripe is the only record: the subscription's metadata
// holds `device`, `plan`, `or_hash` and `or_key` (the key, encrypted).

import { PLANS, env } from './config.js';
import { createKey, updateKey } from './openrouter.js';
import { encryptSecret } from './pass.js';
import { isLive, planOf, stripe } from './stripe.js';

/**
 * Live subscription: make sure its key exists, is enabled and capped for
 * its plan. Anything else: disable the key.
 *
 * Only `checkout.session.completed` may create a key (`allowCreate`).
 * Stripe sends several events per checkout, and letting each of them
 * create one could leave a subscription with two keys.
 *
 * Idempotent: writing metadata here triggers another
 * `customer.subscription.updated`, which then finds nothing to change.
 */
export async function syncSubscription(subscription, { allowCreate }) {
  const plan = planOf(subscription);
  const live = isLive(subscription) && plan !== null;
  const metadata = subscription.metadata ?? {};

  if (!metadata.or_hash) {
    if (!live || !allowCreate) return;
    const { hash, key } = await createKey({
      name: `TheCloser ${plan} ${subscription.id}`,
      limitUSD: PLANS[plan].allowanceUSD,
    });
    await stripe().subscriptions.update(subscription.id, {
      metadata: { plan, or_hash: hash, or_key: encryptSecret(key, env('PASS_SECRET')) },
    });
    return;
  }

  if (live) {
    await updateKey(metadata.or_hash, { disabled: false, limit: PLANS[plan].allowanceUSD, limit_reset: 'monthly' });
    if (metadata.plan !== plan) await stripe().subscriptions.update(subscription.id, { metadata: { plan } });
  } else {
    await updateKey(metadata.or_hash, { disabled: true });
  }
}
