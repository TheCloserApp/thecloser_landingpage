import Stripe from 'stripe';
import { env, planForLookupKey } from './config.js';

let client;

export function stripe() {
  client ??= new Stripe(env('STRIPE_SECRET_KEY'));
  return client;
}

export const LIVE_STATUSES = new Set(['active', 'trialing']);

export function isLive(subscription) {
  return LIVE_STATUSES.has(subscription?.status);
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
