// Stripe holds the billing state and encrypted per-subscriber key. Always
// retrieve current state: webhook snapshots can be duplicated or reordered.
import { DEVICE_PATTERN, PLANS, env } from './config.js';
import { createKey, keyStatus, updateKey } from './openrouter.js';
import { encryptSecret } from './pass.js';
import { serial } from './serial.js';
import { isLive, objectId, planOf, stripe } from './stripe.js';

const roundUSD = (value) => Math.round(value * 1e6) / 1e6;
export function periodLimit(metadata, plan) {
  return roundUSD(Number(metadata?.or_base ?? 0) + PLANS[plan].allowanceUSD);
}

export function invoiceSubscriptionId(invoice) {
  // Support both the current Stripe shape and older webhook API versions.
  return objectId(invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription);
}
export function renewedSubscriptionId(invoice) {
  return invoice?.billing_reason === 'subscription_cycle' ? invoiceSubscriptionId(invoice) : null;
}

export async function latestInvoice(subscription) {
  const invoice = subscription?.latest_invoice;
  return typeof invoice === 'string' ? stripe().invoices.retrieve(invoice) : invoice ?? null;
}
export const invoiceIsPaid = (invoice) => invoice?.status === 'paid';

/** Only a current, paid invoice enables service, including delayed payments.
 * Same-instance calls serialize; Stripe metadata is not a distributed lock.
 * Keys start disabled so a metadata-write failure leaves no usable orphan.
 */
export async function syncSubscription(subscriptionId, { allowCreate = false } = {}) {
  return serial(`subscription:${subscriptionId}`, async () => {
    let subscription = await stripe().subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
    const plan = planOf(subscription);
    let metadata = subscription.metadata ?? {};
    const invoice = await latestInvoice(subscription);
    const entitled = isLive(subscription) && plan !== null
      && DEVICE_PATTERN.test(metadata.device ?? '') && invoiceIsPaid(invoice);
    if (!entitled) {
      if (metadata.or_hash) await updateKey(metadata.or_hash, { disabled: true });
      return subscription;
    }
    const periodStart = subscription.items?.data?.[0]?.current_period_start
      ?? subscription.current_period_start ?? invoice.period_start;
    if (!Number.isSafeInteger(periodStart) || periodStart <= 0) throw new Error('Subscription has no billing period start');

    if (!metadata.or_hash) {
      if (!allowCreate) return subscription;
      // Check encryption configuration before creating anything remotely.
      const secret = env('PASS_SECRET');
      const { hash, key } = await createKey({
        name: `TheCloser ${plan} ${subscription.id}`,
        limitUSD: periodLimit({}, plan), disabled: true,
      });
      await stripe().subscriptions.update(subscription.id, { metadata: {
        plan, or_hash: hash, or_key: encryptSecret(key, secret), or_base: '0',
        or_period: invoice.id, or_period_start: String(periodStart),
      } });
      subscription = await stripe().subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
      metadata = subscription.metadata;
      // A concurrent writer may have won; leave our unused candidate disabled.
      if (metadata.or_hash !== hash) return subscription;
    } else {
      const savedStart = Number(metadata.or_period_start ?? 0);
      const legacyRenewal = !savedStart && invoice.billing_reason === 'subscription_cycle' && metadata.or_period !== invoice.id;
      if ((savedStart && periodStart > savedStart) || legacyRenewal) {
        const { totalUsageUSD } = await keyStatus(metadata.or_hash);
        const period = {
          or_base: String(roundUSD(totalUsageUSD)), or_period: invoice.id,
          or_period_start: String(periodStart),
        };
        await stripe().subscriptions.update(subscriptionId, { metadata: period });
        metadata = { ...metadata, ...period };
      } else if (!savedStart) {
        // Migrate existing Mac subscribers without resetting their allowance.
        await stripe().subscriptions.update(subscriptionId, { metadata: { or_period_start: String(periodStart) } });
      }
    }
    await updateKey(metadata.or_hash, { disabled: false, limit: periodLimit(metadata, plan), limit_reset: null });
    if (metadata.plan !== plan) await stripe().subscriptions.update(subscriptionId, { metadata: { plan } });
    return stripe().subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
  });
}

// Retained for callers/tests; current Stripe state determines which period is
// paid, so an old invoice can never refill a newer allowance a second time.
export async function startNewPeriod(subscriptionId) {
  return syncSubscription(subscriptionId, { allowCreate: true });
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
