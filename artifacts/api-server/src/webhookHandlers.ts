import type Stripe from 'stripe';
import { db } from '@workspace/db';
import { usersTable } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import { getStripeSync, getUncachableStripeClient } from './stripeClient.js';

/**
 * Reverse map: Stripe price_id -> plan name in our DB.
 * Pulled from env vars set in Replit secrets.
 */
function priceToPlan(): Record<string, string> {
  return {
    [process.env.STRIPE_PRICE_STARTER || '__none1']: 'starter',
    [process.env.STRIPE_PRICE_PRO     || '__none2']: 'pro',
    [process.env.STRIPE_PRICE_ELITE   || '__none3']: 'elite',
  };
}

async function resolveUserId(
  stripe: Stripe,
  customerId: string | null,
  metadataUserId?: string | null,
): Promise<string | null> {
  // 1. Prefer metadata embedded directly on the event (subscription or session) —
  //    set by createCheckoutSession so it survives even if the customer record is later modified.
  if (metadataUserId) return metadataUserId;
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer && !('deleted' in customer && customer.deleted)) {
      return ((customer as Stripe.Customer).metadata?.userId as string) || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function setUserPlan(userId: string, plan: string, subscriptionId: string | null, customerId: string | null) {
  const updates: Record<string, any> = { plan };
  if (subscriptionId !== undefined) updates.stripeSubscriptionId = subscriptionId;
  if (customerId)                   updates.stripeCustomerId     = customerId;
  await db.update(usersTable).set(updates as any).where(eq(usersTable.id, userId));
  console.log(`[stripe-webhook] user ${userId} -> plan=${plan} sub=${subscriptionId ?? 'none'}`);
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. Received type: ' + typeof payload + '. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).',
      );
    }

    // Step 1 — let stripe-replit-sync mirror Stripe state into our DB tables.
    try {
      const sync = await getStripeSync();
      await sync.processWebhook(payload, signature);
    } catch (err: any) {
      console.error('[stripe-webhook] sync.processWebhook failed:', err.message);
      // Don't return — we still want to try our custom plan-update logic.
    }

    // Step 2 — verify the event ourselves and run plan-mapping logic.
    const stripe = await getUncachableStripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — cannot verify event for plan update');
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (err: any) {
      console.error('[stripe-webhook] signature verify failed:', err.message);
      return;
    }

    const map = priceToPlan();

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode !== 'subscription') break;
          const userId = await resolveUserId(stripe, session.customer as string | null, session.metadata?.userId);
          if (!userId) { console.warn('[stripe-webhook] checkout.session.completed: no userId resolved'); break; }
          const subscriptionId = session.subscription as string | null;
          if (!subscriptionId) break;
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data[0]?.price?.id || '';
          const plan = map[priceId];
          if (!plan) { console.warn(`[stripe-webhook] No plan mapped for price ${priceId}`); break; }
          await setUserPlan(userId, plan, subscriptionId, session.customer as string | null);
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          const userId = await resolveUserId(stripe, sub.customer as string, sub.metadata?.userId);
          if (!userId) break;
          const priceId = sub.items.data[0]?.price?.id || '';
          const plan = map[priceId];
          const status = sub.status;
          if ((status === 'active' || status === 'trialing') && plan) {
            await setUserPlan(userId, plan, sub.id, sub.customer as string);
          } else if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
            await setUserPlan(userId, 'free', null, sub.customer as string);
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const userId = await resolveUserId(stripe, sub.customer as string, sub.metadata?.userId);
          if (!userId) break;
          await setUserPlan(userId, 'free', null, sub.customer as string);
          break;
        }

        default:
          /* not interesting — already mirrored by sync */
          break;
      }
    } catch (err: any) {
      console.error('[stripe-webhook] plan-update handler error:', err?.message ?? err);
    }
  }
}
