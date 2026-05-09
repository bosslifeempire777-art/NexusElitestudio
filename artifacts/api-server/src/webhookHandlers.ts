import type Stripe from 'stripe';
import { db } from '@workspace/db';
import { usersTable } from '@workspace/db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { getStripeSync, getUncachableStripeClient } from './stripeClient.js';
import { defaultPublicBaseUrl, mintCheckoutUrlForUser } from './routes/stripe.js';
import { sendRecoveryEmail } from './lib/recoveryEmail.js';
import { LAUNCH_PROMO, isPromoActive } from './lib/promo.js';

/**
 * Reverse map: Stripe price_id -> plan name in our DB.
 * Pulled from env vars set in Replit secrets.
 */
export function priceToPlan(): Record<string, string> {
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

export async function setUserPlan(userId: string, plan: string, subscriptionId: string | null, customerId: string | null) {
  const updates: Record<string, any> = { plan };
  if (subscriptionId !== undefined) updates.stripeSubscriptionId = subscriptionId;
  if (customerId)                   updates.stripeCustomerId     = customerId;
  await db.update(usersTable).set(updates as any).where(eq(usersTable.id, userId));
  console.log(`[stripe-webhook] user ${userId} -> plan=${plan} sub=${subscriptionId ?? 'none'}`);
}

/**
 * Read every webhook signing secret we should accept. Returns them in
 * priority order. Supports:
 *   - STRIPE_WEBHOOK_SECRET = "whsec_…"                    (single)
 *   - STRIPE_WEBHOOK_SECRET = "whsec_a,whsec_b"            (comma-separated)
 *   - STRIPE_WEBHOOK_SECRETS = "whsec_a,whsec_b"           (alt name)
 *   - STRIPE_WEBHOOK_SECRET_2, STRIPE_WEBHOOK_SECRET_3 …   (numbered fallbacks)
 *
 * We support multiple because production has TWO live webhook endpoints
 * registered on the Stripe dashboard (one for nexuselitestudio.com and
 * one for nexuselitestudio.nexus). Each endpoint has its own signing
 * secret, so the app must accept either one or roughly half of incoming
 * webhooks will fail signature verification.
 */
export function getWebhookSecrets(): string[] {
  const secrets: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    for (const s of raw.split(',')) {
      const t = s.trim();
      if (t && !secrets.includes(t)) secrets.push(t);
    }
  };
  push(process.env.STRIPE_WEBHOOK_SECRET);
  push(process.env.STRIPE_WEBHOOK_SECRETS);
  for (let i = 2; i <= 5; i++) push(process.env[`STRIPE_WEBHOOK_SECRET_${i}`]);
  return secrets;
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
    // This is best-effort: in environments where the `stripe.*` schema has
    // never been migrated (e.g. the prod DB on Render) every call here
    // throws "relation does not exist". That's noisy but non-fatal — our
    // own plan-mapping logic below is what actually upgrades users.
    try {
      const sync = await getStripeSync();
      await sync.processWebhook(payload, signature);
    } catch (err: any) {
      console.error('[stripe-webhook] sync.processWebhook failed:', err.message);
      // Don't return — we still want to try our custom plan-update logic.
    }

    // Step 2 — verify the event ourselves and run plan-mapping logic.
    const stripe = await getUncachableStripeClient();
    const secrets = getWebhookSecrets();
    if (secrets.length === 0) {
      // Throw so the route returns 4xx and Stripe will RETRY the delivery
      // once the secret is configured. The previous behaviour was to log
      // and return 200, which silently dropped events forever.
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is not configured. Set it to the signing secret(s) ' +
        'shown on the Stripe Dashboard "Developers → Webhooks" page. If you have ' +
        'more than one endpoint registered, set STRIPE_WEBHOOK_SECRET to a ' +
        'comma-separated list of secrets.',
      );
    }

    let event: Stripe.Event | null = null;
    let lastErr: any = null;
    for (const secret of secrets) {
      try {
        event = stripe.webhooks.constructEvent(payload, signature, secret);
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
      }
    }
    if (!event) {
      // Re-throw so the HTTP route returns 4xx → Stripe will retry the
      // delivery later (and surfaces the failure in the dashboard) instead
      // of marking it "Succeeded" while we silently drop it.
      throw new Error(
        `[stripe-webhook] signature verify failed against ${secrets.length} ` +
        `configured secret(s): ${lastErr?.message ?? 'unknown error'}. ` +
        `If you have multiple Stripe webhook endpoints (e.g. one per domain), ` +
        `set STRIPE_WEBHOOK_SECRET to a comma-separated list of all signing secrets.`,
      );
    }

    const map = priceToPlan();

    // NOTE: this block intentionally does NOT swallow errors anymore.
    // For billing-critical events, a failed DB write (network blip,
    // transient connection pool error, etc.) should propagate so the
    // webhook route returns 4xx and Stripe RETRIES the delivery on its
    // exponential backoff. The previous `try/catch` around this block
    // logged the error and returned 200 OK, which silently lost plan
    // upgrades on every transient DB error.
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

      case 'checkout.session.expired': {
        // Cart-recovery: Stripe sends this ~24h after a Checkout Session was
        // created if the buyer never completed payment. We email the user a
        // fresh checkout link (re-applying the launch promo if still active),
        // capped at one recovery email per user per 7 days so we don't spam.
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;
        await handleCheckoutSessionExpired(stripe, session, map);
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
  }
}

const RECOVERY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Handle a Stripe `checkout.session.expired` event for a subscription
 * checkout. Looks up the originating user, figures out which plan they were
 * trying to buy, mints a fresh Checkout URL (re-applying the launch promo
 * if still active), and emails them — at most once per 7 days.
 */
async function handleCheckoutSessionExpired(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  priceMap: Record<string, string>,
): Promise<void> {
  const customerId = session.customer as string | null;
  const userId = await resolveUserId(stripe, customerId, session.metadata?.userId);
  if (!userId) {
    console.log('[stripe-webhook] checkout.session.expired: no userId resolved, skipping recovery email');
    return;
  }

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user) return;
  if (!user.email) {
    console.log(`[stripe-webhook] expired session for user ${userId} but no email on file, skipping`);
    return;
  }
  // Don't bother chasing users who already converted between session
  // creation and the 24h expiry window.
  if (user.plan && user.plan !== 'free') return;

  // Figure out which plan the buyer was attempting. Stripe doesn't include
  // line_items on the session payload by default, so fetch them explicitly.
  // We do this BEFORE acquiring the cooldown lock so we don't burn a 7-day
  // slot on a session whose plan we can't even identify.
  let planName: string | undefined;
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    const priceId = lineItems.data[0]?.price?.id ?? '';
    planName = priceMap[priceId];
  } catch (err: any) {
    console.warn(`[stripe-webhook] could not fetch line items for ${session.id}: ${err.message}`);
  }
  if (!planName) {
    console.log(`[stripe-webhook] expired session ${session.id}: could not determine plan, skipping`);
    return;
  }

  // Atomic cooldown lock: claim the 7-day slot via a single conditional
  // UPDATE that only succeeds when the previous send is null or older than
  // the cooldown window. Anything else (concurrent expired-session events,
  // Stripe webhook retries after a downstream failure, replays of the same
  // event id) loses the race and exits without sending. This is the only
  // way to keep "at most one email per user per 7 days" honest under
  // realistic retry / concurrency conditions — checking in memory and
  // writing after the send is racy and double-fires on retry.
  const previousSentAt = user.lastRecoveryEmailAt;
  const cooldownCutoff = new Date(Date.now() - RECOVERY_COOLDOWN_MS);
  const claimed = await db.update(usersTable)
    .set({ lastRecoveryEmailAt: new Date() })
    .where(and(
      eq(usersTable.id, userId),
      or(isNull(usersTable.lastRecoveryEmailAt), lt(usersTable.lastRecoveryEmailAt, cooldownCutoff)),
    ))
    .returning({ id: usersTable.id });

  if (claimed.length === 0) {
    console.log(`[stripe-webhook] recovery email suppressed for user ${userId} (within 7d cooldown or lost race)`);
    return;
  }

  try {
    const baseUrl = defaultPublicBaseUrl();
    const checkoutUrl = await mintCheckoutUrlForUser({ userId, planName, baseUrl });
    if (!checkoutUrl) {
      throw new Error('failed to mint recovery checkout URL');
    }

    await sendRecoveryEmail({
      to: user.email,
      username: user.username ?? null,
      planName,
      checkoutUrl,
      promoActive: isPromoActive(),
      discountPercent: LAUNCH_PROMO.discountPercent,
    });
  } catch (err: any) {
    // Send failed — release the cooldown slot by restoring the previous
    // timestamp so a Stripe retry (or a future expired session) can try
    // again instead of being silently locked out for 7 days.
    console.error(`[stripe-webhook] recovery email send failed for user ${userId}: ${err.message}; releasing cooldown lock`);
    await db.update(usersTable)
      .set({ lastRecoveryEmailAt: previousSentAt ?? null })
      .where(eq(usersTable.id, userId));
    throw err;
  }
}
