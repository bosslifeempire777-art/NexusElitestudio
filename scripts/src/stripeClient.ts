import Stripe from 'stripe';

export async function getUncachableStripeClient(): Promise<Stripe> {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
  }
  return new Stripe(apiKey, {
    apiVersion: Stripe.API_VERSION as Stripe.StripeConfig['apiVersion'],
  });
}
