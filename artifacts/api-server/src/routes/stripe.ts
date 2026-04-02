import { Router, type IRouter } from 'express';
import { db } from '@workspace/db';
import { usersTable } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import { storage } from '../storage.js';
import { stripeService } from '../stripeService.js';
import { requireAuth } from '../middleware/auth.js';

const router: IRouter = Router();

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

/* ── Auth-protected: checkout, portal, subscription ─────────── */

router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { priceId, planName } = req.body;

    if (!priceId && !planName) {
      res.status(400).json({ error: 'priceId or planName is required' });
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    let customerId = (user as any).stripeCustomerId as string | undefined;

    if (!customerId) {
      const customer = await stripeService.createCustomer(user.email, userId);
      await db.update(usersTable)
        .set({ stripeCustomerId: customer.id } as any)
        .where(eq(usersTable.id, userId));
      customerId = customer.id;
    }

    const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || process.env.REPLIT_DEV_DOMAIN || 'localhost';
    const baseUrl = `https://${domain}`;

    const session = await stripeService.createCheckoutSession(
      customerId,
      priceId,
      `${baseUrl}/dashboard?upgrade=success`,
      `${baseUrl}/pricing`,
    );

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

    const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || process.env.REPLIT_DEV_DOMAIN || 'localhost';
    const session = await stripeService.createCustomerPortalSession(
      customerId,
      `https://${domain}/settings`,
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
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set — webhook verification skipped');
    res.json({ received: true });
    return;
  }

  if (!sig) {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  try {
    // Body must be raw Buffer — handled by express.raw() in app.ts for this route
    const payload = req.body as Buffer;
    if (!Buffer.isBuffer(payload)) {
      res.status(400).json({ error: 'Webhook body must be raw Buffer. Ensure webhook route uses express.raw().' });
      return;
    }
    await import('../webhookHandlers.js').then(m =>
      m.WebhookHandlers.processWebhook(payload, sig as string),
    );
    res.json({ received: true });
  } catch (err: any) {
    console.error('Webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
