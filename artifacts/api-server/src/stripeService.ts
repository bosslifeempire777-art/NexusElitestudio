import { storage } from './storage.js';
import { getUncachableStripeClient } from './stripeClient.js';

export class StripeService {
  async createCustomer(email: string, userId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({
      email,
      metadata: { userId },
    });
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    couponId?: string,
    userId?: string,
  ) {
    const stripe = await getUncachableStripeClient();
    // Offer multiple payment methods so buyers without a credit card can
    // still convert. Apple Pay and Google Pay are wallet variants of `card`
    // and are surfaced automatically by Stripe when `card` is enabled —
    // they aren't separate `payment_method_types` values.
    //   - link              — one-tap email-based reuse for returning buyers
    //   - cashapp           — popular non-card option in the US
    //   - us_bank_account   — ACH direct debit (lower fees, no card needed)
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card', 'link', 'cashapp', 'us_bank_account'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Embed userId in BOTH the session and the subscription so the webhook
      // handler can map a payment back to our internal user even when the
      // customer object's metadata is missing.
      ...(userId ? {
        metadata: { userId },
        subscription_data: { metadata: { userId } },
      } : {}),
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      allow_promotion_codes: couponId ? false : true,
    });
  }

  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async getProduct(productId: string) {
    return await storage.getProduct(productId);
  }

  async getSubscription(subscriptionId: string) {
    return await storage.getSubscription(subscriptionId);
  }
}

export const stripeService = new StripeService();
