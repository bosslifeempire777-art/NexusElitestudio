import Stripe from 'stripe';

export async function getUncachableStripeClient(): Promise<Stripe> {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('Stripe is not configured. Please connect your Stripe account or set STRIPE_SECRET_KEY.');
  }
  return new Stripe(apiKey, { apiVersion: '2025-02-24.acacia' });
}

export async function getStripeSync() {
  throw new Error('Stripe sync is not configured. Please connect your Stripe account.');
}
