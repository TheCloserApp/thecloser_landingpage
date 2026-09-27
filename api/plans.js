// Actual purchase terms from the shared Mac/Windows Stripe catalog.
// /models stays unchanged for existing clients.
import { PLANS } from './_lib/config.js';
import { handle, json } from './_lib/http.js';
import { activePrice } from './_lib/stripe.js';

export const GET = handle(async () => {
  const entries = await Promise.all(Object.entries(PLANS).map(async ([id, plan]) => {
    const price = await activePrice(id);
    return [id, {
      name: plan.name, allowanceUSD: plan.allowanceUSD, models: plan.models,
      price: price ? {
        unitAmount: price.unit_amount, currency: price.currency,
        interval: price.recurring.interval, intervalCount: price.recurring.interval_count,
      } : null,
    }];
  }));
  return json(200, { plans: Object.fromEntries(entries) });
});
