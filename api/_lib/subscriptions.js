// Keeps each subscriber's OpenRouter key in step with their Stripe
// subscription. Stripe is the only record: the subscription's metadata
// holds `device`, `plan`, `or_hash`, `or_key` (the key, encrypted),
// `or_base` (the key's total spend when the current billing period began)
// and `or_period` (the renewal invoice that began it).
//
// The key's cap is always `or_base` + the plan's allowance. Each paid
// renewal moves `or_base` up to the spend so far, which gives a fresh
// allowance on the subscriber's billing date. A plan change mid-period
// applies the new allowance to the current period.

import { PLANS, env } from './config.js';
import { createKey, keyStatus, updateKey } from './openrouter.js';
import { encryptSecret } from './pass.js';
import { isLive, planOf, stripe } from './stripe.js';

const roundUSD = (value) => Math.round(value * 1e6) / 1e6;

/** The key's cap for the current period. */
export function periodLimit(metadata, plan) {
  return roundUSD(Number(metadata?.or_base ?? 0) + PLANS[plan].allowanceUSD);
}

/**
 * Brings the key in line with the subscription. Live: make sure the key
 * exists, is enabled and capped for its plan. Anything else: disable it.
 *
 * Reads the subscription fresh rather than trusting the event's copy:
 * Stripe can deliver events late or out of order, and old metadata would
 * undo a renewal's new cap.
 *
 * Only `checkout.session.completed` may create a key (`allowCreate`).
 * Stripe sends several events per checkout, and letting each of them
 * create one could leave a subscription with two keys.
 *
 * Idempotent: writing metadata here triggers another
 * `customer.subscription.updated`, which then finds nothing to change.
 */
export async function syncSubscription(subscriptionId, { allowCreate }) {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const plan = planOf(subscription);
  const live = isLive(subscription) && plan !== null;
  const metadata = subscription.metadata ?? {};

  if (!metadata.or_hash) {
    if (!live || !allowCreate) return;
    const { hash, key } = await createKey({
      name: `TheCloser ${plan} ${subscription.id}`,
      limitUSD: periodLimit({}, plan),
    });
    await stripe().subscriptions.update(subscription.id, {
      metadata: { plan, or_hash: hash, or_key: encryptSecret(key, env('PASS_SECRET')), or_base: '0' },
    });
    return;
  }

  if (live) {
    await updateKey(metadata.or_hash, { disabled: false, limit: periodLimit(metadata, plan), limit_reset: null });
    if (metadata.plan !== plan) await stripe().subscriptions.update(subscription.id, { metadata: { plan } });
  } else {
    await updateKey(metadata.or_hash, { disabled: true });
  }
}

/** The subscription a renewal invoice belongs to, or null for any other invoice. */
export function renewedSubscriptionId(invoice) {
  if (invoice?.billing_reason !== 'subscription_cycle') return null;
  const subscription = invoice.parent?.subscription_details?.subscription;
  return typeof subscription === 'string' ? subscription : subscription?.id ?? null;
}

/**
 * A renewal was paid: start a new period with a full allowance. Stripe can
 * send the same invoice twice; `or_period` keeps the second time from
 * moving the base again, and the cap is simply applied again.
 */
export async function startNewPeriod(subscriptionId, invoiceId) {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const plan = planOf(subscription);
  let metadata = subscription.metadata ?? {};
  if (!metadata.or_hash || !plan) return;

  if (metadata.or_period !== invoiceId) {
    const { totalUsageUSD } = await keyStatus(metadata.or_hash);
    const period = { or_base: String(roundUSD(totalUsageUSD)), or_period: invoiceId };
    await stripe().subscriptions.update(subscriptionId, { metadata: period });
    metadata = { ...metadata, ...period };
  }
  await updateKey(metadata.or_hash, { limit: periodLimit(metadata, plan), limit_reset: null });
}

/** What the app shows: how much of this period's allowance is used, and when it resets. */
export function usageSummary(subscription, key) {
  const plan = planOf(subscription);
  const { allowanceUSD } = PLANS[plan];
  const usedUSD = roundUSD(Math.max(0, key.totalUsageUSD - Number(subscription.metadata?.or_base ?? 0)));
  return {
    plan,
    allowanceUSD,
    usedUSD,
    remainingUSD: roundUSD(Math.max(0, key.remainingUSD ?? 0)),
    usedFraction: Math.min(1, roundUSD(usedUSD / allowanceUSD)),
    periodEnd: subscription.items?.data?.[0]?.current_period_end ?? null,
    renews: !subscription.cancel_at_period_end && !subscription.cancel_at,
  };
}
