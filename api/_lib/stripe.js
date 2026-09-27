import Stripe from 'stripe';
import { PLANS, env, isPlan, planForLookupKey } from './config.js';

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
  if (!isPlan(plan)) return null;
  const prices = await stripe().prices.list({ lookup_keys: [PLANS[plan].lookupKey], active: true, limit: 1 });
  const price = prices.data[0] ?? null;
  // Each supported plan grants one fixed monthly allowance.
  if (!price || price.type !== 'recurring' || price.recurring?.interval !== 'month'
      || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed'
      || !Number.isSafeInteger(price.unit_amount) || price.unit_amount < 0) {
    console.error(`No valid monthly Stripe price with lookup key ${PLANS[plan].lookupKey}`);
    return null;
  }
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
  return findSubscription(device, isLive);
}

export const isExisting = (subscription) => subscription && !['canceled', 'incomplete_expired'].includes(subscription.status);

/** Search all pages so cancelled subscriptions cannot hide a current one. */
export async function findSubscription(device, predicate = isExisting) {
  let page;
  do {
    const result = await stripe().subscriptions.search({
      query: `metadata['device']:'${device}'`, limit: 100, ...(page ? { page } : {}),
    });
    const found = result.data.find((subscription) => subscription.metadata?.device === device && predicate(subscription));
    if (found) return found;
    page = result.has_more ? result.next_page : null;
  } while (page);
  return null;
}

export const objectId = (value) => typeof value === 'string' ? value : value?.id ?? null;

/** Reuse one customer per device; idempotency covers fresh search lag. */
export async function checkoutCustomer(device) {
  const existing = await stripe().customers.search({ query: `metadata['device']:'${device}'`, limit: 1 });
  if (existing.data[0]) return existing.data[0];
  return stripe().customers.create({ metadata: { device } }, { idempotencyKey: `thecloser-customer-v1-${device}` });
}
