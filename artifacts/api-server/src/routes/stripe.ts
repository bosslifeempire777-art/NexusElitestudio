import { Router, type IRouter } from 'express';
import { storage } from '../storage.js';
import { stripeService } from '../stripeService.js';

const router: IRouter = Router();

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
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const prices = await storage.getPricesForProduct(productId);
    res.json({ data: prices });
  } catch {
    res.status(503).json({ data: [], error: 'Stripe not yet initialized' });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'demo-user';
    const { priceId } = req.body;

    if (!priceId) {
      return res.status(400).json({ error: 'priceId is required' });
    }

    let user = await storage.getUser(userId);
    let customerId = (user as any)?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripeService.createCustomer(
        (user as any)?.email || `${userId}@aistudio.dev`,
        userId
      );
      await storage.updateUserStripeInfo(userId, { stripeCustomerId: customer.id });
      customerId = customer.id;
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost'}`;
    const session = await stripeService.createCheckoutSession(
      customerId,
      priceId,
      `${baseUrl}/checkout/success`,
      `${baseUrl}/pricing`
    );

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/portal', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'demo-user';
    const user = await storage.getUser(userId);
    const customerId = (user as any)?.stripeCustomerId;

    if (!customerId) {
      return res.status(400).json({ error: 'No Stripe customer found for this user' });
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost'}`;
    const session = await stripeService.createCustomerPortalSession(
      customerId,
      `${baseUrl}/settings`
    );

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/subscription', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'demo-user';
    const user = await storage.getUser(userId);
    const subscriptionId = (user as any)?.stripeSubscriptionId;

    if (!subscriptionId) {
      return res.json({ subscription: null });
    }

    const subscription = await storage.getSubscription(subscriptionId);
    res.json({ subscription });
  } catch {
    res.json({ subscription: null });
  }
});

export default router;
