// POST /api/stripe-webhook — Stripe's event notifications.
// Register this URL in Stripe (Developers → Webhooks) for:
//   checkout.session.completed
//   checkout.session.async_payment_succeeded
//   checkout.session.async_payment_failed
//   invoice.payment_failed
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.paid
// A failure answers 500, and Stripe retries.

import { ConfigError, env } from './_lib/config.js';
import { describeFailure, json } from './_lib/http.js';
import { stripe } from './_lib/stripe.js';
import { invoiceSubscriptionId, syncSubscription } from './_lib/subscriptions.js';

export async function POST(request) {
  let event;
  try {
    event = stripe().webhooks.constructEvent(
      await request.text(),
      request.headers.get('stripe-signature') ?? '',
      env('STRIPE_WEBHOOK_SECRET'),
    );
  } catch (error) {
    if (error instanceof ConfigError) return json(500, describeFailure(error));
    console.error('Rejected webhook:', error.message);
    return json(400, { error: 'invalid_signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          await syncSubscription(typeof session.subscription === 'string' ? session.subscription : session.subscription.id, {
            allowCreate: ['paid', 'no_payment_required'].includes(session.payment_status),
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object.id, { allowCreate: false });
        break;
      case 'invoice.payment_failed':
      case 'invoice.payment_action_required':
      case 'invoice.paid': {
        const subscriptionId = invoiceSubscriptionId(event.data.object);
        if (subscriptionId) await syncSubscription(subscriptionId, { allowCreate: event.type === 'invoice.paid' });
        break;
      }
    }
  } catch (error) {
    console.error(`Handling ${event.type} ${event.id} failed:`, error);
    return json(500, { error: 'handler_failed' });
  }
  return json(200, { received: true });
}
