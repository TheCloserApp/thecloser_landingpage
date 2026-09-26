// POST /api/stripe-webhook — Stripe's event notifications.
// Register this URL in Stripe (Developers → Webhooks) for:
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted
// A failure answers 500, and Stripe retries.

import { env } from './_lib/config.js';
import { json } from './_lib/http.js';
import { stripe } from './_lib/stripe.js';
import { syncSubscription } from './_lib/subscriptions.js';

export async function POST(request) {
  let event;
  try {
    event = stripe().webhooks.constructEvent(
      await request.text(),
      request.headers.get('stripe-signature') ?? '',
      env('STRIPE_WEBHOOK_SECRET'),
    );
  } catch (error) {
    console.error('Rejected webhook:', error.message);
    return json(400, { error: 'invalid_signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          const subscription = await stripe().subscriptions.retrieve(session.subscription);
          await syncSubscription(subscription, { allowCreate: true });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object, { allowCreate: false });
        break;
    }
  } catch (error) {
    console.error(`Handling ${event.type} ${event.id} failed:`, error);
    return json(500, { error: 'handler_failed' });
  }
  return json(200, { received: true });
}
