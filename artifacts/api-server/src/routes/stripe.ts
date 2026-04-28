import { Router, type IRouter } from 'express';
import { db } from '@workspace/db';
import { usersTable } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import { storage } from '../storage.js';
import { stripeService } from '../stripeService.js';
import { requireAuth } from '../middleware/auth.js';
import { LAUNCH_PROMO, isPromoActive } from '../lib/promo.js';

const router: IRouter = Router();

/**
 * Pick the right base URL to send Stripe redirects back to. Honors the
 * Origin/Referer of the incoming request so checkouts initiated from
 * nexuselitestudio.com return to .com, and ones from nexuselitestudio.nexus
 * return to .nexus. Allowlist prevents redirect-injection abuse.
 */
function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>([
    'nexuselitestudio.com',
    'www.nexuselitestudio.com',
    'nexuselitestudio.nexus',
    'www.nexuselitestudio.nexus',
  ]);
  if (process.env.CUSTOM_DOMAIN)     hosts.add(process.env.CUSTOM_DOMAIN);
  if (process.env.REPLIT_DEV_DOMAIN) hosts.add(process.env.REPLIT_DEV_DOMAIN);
  if (process.env.REPLIT_DOMAINS) {
    for (const d of process.env.REPLIT_DOMAINS.split(',')) {
      const trimmed = d.trim(); if (trimmed) hosts.add(trimmed);
    }
  }
  return hosts;
}
const ALLOWED_HOSTS = buildAllowedHosts();

function resolveBaseUrl(req: { headers: Record<string, any> }): string {
  const candidates: string[] = [];
  const origin  = String(req.headers.origin  || '');
  const referer = String(req.headers.referer || '');
  if (origin)  candidates.push(origin);
  if (referer) {
    try { candidates.push(new URL(referer).origin); } catch { /* ignore */ }
  }
  const requireHttps = process.env.NODE_ENV === 'production';
  for (const c of candidates) {
    try {
      const u = new URL(c);
      if (requireHttps && u.protocol !== 'https:') continue;
      if (ALLOWED_HOSTS.has(u.hostname)) return `${u.protocol}//${u.host}`;
    } catch { /* ignore */ }
  }
  const fallback = process.env.CUSTOM_DOMAIN
    || process.env.REPLIT_DOMAINS?.split(',')[0]
    || process.env.REPLIT_DEV_DOMAIN
    || 'localhost';
  return `https://${fallback}`;
}

/* ── Public: product / price listings ─────────────────────── */
router.get('/products', async (_req, res) => {
  try {
    const products = await storage.listProducts();
    res.json({ data: products });
  } catch {
    res.status(503).json({ data: [], error: 'Stripe not yet initialized' });
  }
});

router.get('/products-with-prices', async (_req, res) => {
  try {
    const rows = await storage.listProductsWithPrices();
    const productsMap = new Map<string, any>();
    for (const row of rows as any[]) {
      if (!productsMap.has(row.product_id)) {
        productsMap.set(row.product_id, {
          id: row.product_id,
          name: row.product_name,
          description: row.product_description,
          active: row.product_active,
          prices: [],
        });
      }
      if (row.price_id) {
        productsMap.get(row.product_id).prices.push({
          id: row.price_id,
          unit_amount: row.unit_amount,
          currency: row.currency,
          recurring: row.recurring,
          active: row.price_active,
        });
      }
    }
    res.json({ data: Array.from(productsMap.values()) });
  } catch {
    res.status(503).json({ data: [], error: 'Stripe not yet initialized' });
  }
});

router.get('/prices', async (_req, res) => {
  try {
    const prices = await storage.listPrices();
    res.json({ data: prices });
  } catch {
    res.status(503).json({ data: [], error: 'Stripe not yet initialized' });
  }
});

router.get('/products/:productId/prices', async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await storage.getProduct(productId);
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
    const prices = await storage.getPricesForProduct(productId);
    res.json({ data: prices });
  } catch {
    res.status(503).json({ data: [], error: 'Stripe not yet initialized' });
  }
});

/* ── Public: launch promo info ─────────────────────────────── */
router.get('/promo', (_req, res) => {
  res.json({
    active:          isPromoActive(),
    discountPercent: LAUNCH_PROMO.discountPercent,
    endsAt:          LAUNCH_PROMO.endsAt,
    couponId:        LAUNCH_PROMO.couponId,
  });
});

/* ── Auth-protected: checkout, portal, subscription ─────────── */

/* ── Stripe price ID lookup from env (set these after creating Stripe products) ── */
const STRIPE_PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || "",
  pro:     process.env.STRIPE_PRICE_PRO     || "",
  elite:   process.env.STRIPE_PRICE_ELITE   || "",
};

router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { planName } = req.body;

    if (!planName) {
      res.status(400).json({ error: 'planName is required' });
      return;
    }

    const priceId = STRIPE_PRICE_IDS[planName];
    if (!priceId) {
      res.status(400).json({
        error: 'stripe_not_configured',
        message: `Stripe price ID for plan "${planName}" is not configured. Set STRIPE_PRICE_${planName.toUpperCase()} in environment secrets.`,
      });
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    let customerId = (user as any).stripeCustomerId as string | undefined;

    if (!customerId) {
      const customer = await stripeService.createCustomer(user.email ?? `${userId}@nexuselite.local`, userId);
      await db.update(usersTable)
        .set({ stripeCustomerId: customer.id } as any)
        .where(eq(usersTable.id, userId));
      customerId = customer.id;
    }

    // Multi-domain: use the actual origin the user came from so they get sent
    // back to the SAME website after checkout. Allowlist matches both
    // nexuselitestudio.com and nexuselitestudio.nexus, plus the *.replit.dev
    // dev preview, falling back to CUSTOM_DOMAIN if origin is missing.
    const baseUrl = resolveBaseUrl(req);

    // Try with launch promo coupon first; if Stripe rejects the coupon
    // (deleted, expired, or never existed), retry without it so checkout
    // doesn't break for the customer.
    const couponId = isPromoActive() ? LAUNCH_PROMO.couponId : undefined;
    let session;
    try {
      session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${baseUrl}/dashboard?upgrade=success`,
        `${baseUrl}/pricing?upgrade=cancel&plan=${encodeURIComponent(planName)}`,
        couponId,
        userId,
      );
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (couponId && /coupon|promotion/i.test(msg)) {
        console.warn(`[stripe-checkout] coupon "${couponId}" failed (${msg}); retrying without coupon`);
        session = await stripeService.createCheckoutSession(
          customerId,
          priceId,
          `${baseUrl}/dashboard?upgrade=success`,
          `${baseUrl}/pricing?upgrade=cancel&plan=${encodeURIComponent(planName)}`,
          undefined,
          userId,
        );
      } else {
        throw e;
      }
    }

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/portal', requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    const customerId = (user as any)?.stripeCustomerId as string | undefined;

    if (!customerId) {
      res.status(400).json({ error: 'No Stripe customer found — you have not subscribed yet' });
      return;
    }

    const baseUrl = resolveBaseUrl(req);
    const session = await stripeService.createCustomerPortalSession(
      customerId,
      `${baseUrl}/settings`,
    );

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    const subscriptionId = (user as any)?.stripeSubscriptionId as string | undefined;

    if (!subscriptionId) { res.json({ subscription: null }); return; }

    const subscription = await storage.getSubscription(subscriptionId);
    res.json({ subscription });
  } catch {
    res.json({ subscription: null });
  }
});

/* ── Stripe webhook (raw body required) ─────────────────────── */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  // Body must be raw Buffer — handled by express.raw() in app.ts for this route
  const payload = req.body as Buffer;
  if (!Buffer.isBuffer(payload)) {
    res.status(400).json({ error: 'Webhook body must be raw Buffer. Ensure webhook route uses express.raw().' });
    return;
  }

  try {
    await import('../webhookHandlers.js').then(m =>
      m.WebhookHandlers.processWebhook(payload, sig as string),
    );
    res.json({ received: true });
  } catch (err: any) {
    // Return 400 (NOT 200) so Stripe will retry the delivery instead of
    // marking it "Succeeded" while we silently drop the event. Stripe
    // automatically retries failed webhooks on an exponential backoff for
    // up to 3 days, which gives us a chance to fix config issues without
    // losing checkout.session.completed / subscription events.
    console.error('[stripe-webhook] processing error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
