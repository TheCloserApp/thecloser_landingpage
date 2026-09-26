import Stripe from 'stripe';
import { PLANS, env, planForLookupKey } from './config.js';

let client;

export function stripe() {
  client ??= new Stripe(env('STRIPE_SECRET_KEY'));
  return client;
}

export const LIVE_STATUSES = new Set(['active', 'trialing']);

export function isLive(subscription) {
  return LIVE_STATUSES.has(subscription?.status);
}

/** The plan's current Stripe price (found by lookup key), or null. */
export async function activePrice(plan) {
  const prices = await stripe().prices.list({ lookup_keys: [PLANS[plan].lookupKey], active: true, limit: 1 });
  const price = prices.data[0] ?? null;
  if (!price) console.error(`No active Stripe price with lookup key ${PLANS[plan].lookupKey}`);
  return price;
}

/** "pro" / "pro_max", from the price's lookup key. */
export function planOf(subscription) {
  return planForLookupKey(subscription?.items?.data?.[0]?.price?.lookup_key);
}

/**
 * The live subscription locked to this Mac, if any. Stripe's search is
 * eventually consistent: a subscription can take up to a minute to show
 * up after checkout, so callers retry rather than treat a miss as final.
 * `device` must already match DEVICE_PATTERN (it goes into the query).
 */
export async function findLiveSubscription(device) {
  const result = await stripe().subscriptions.search({ query: `metadata['device']:'${device}'`, limit: 10 });
  return result.data.find(isLive) ?? null;
}
