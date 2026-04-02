/**
 * Run once: node setup-stripe-products.mjs
 * Creates the 3 NexusElite plan products in your connected Stripe account
 * and prints the price IDs to add as Replit secrets.
 */

import Stripe from 'stripe';

// Try Replit connector first, fall back to env var
async function getStripeKey() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const replToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (hostname && replToken) {
    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set('include_secrets', 'true');
    url.searchParams.set('connector_names', 'stripe');
    url.searchParams.set('environment', 'development');
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json', 'X-Replit-Token': replToken },
    });
    const data = await res.json();
    const secret = data.items?.[0]?.settings?.secret;
    if (secret) return secret;
  }

  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  throw new Error('No Stripe credentials found.');
}

const key = await getStripeKey();
const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });

const plans = [
  { name: 'NexusElite Starter', amount: 2900,  envKey: 'STRIPE_PRICE_STARTER', description: '20 builds/mo, 10 projects, all 21 AI agents' },
  { name: 'NexusElite Pro',     amount: 6000,  envKey: 'STRIPE_PRICE_PRO',     description: '75 builds/mo, 30 projects, marketplace listing' },
  { name: 'NexusElite Elite',   amount: 26900, envKey: 'STRIPE_PRICE_ELITE',   description: 'Unlimited builds, white-label, dedicated manager' },
];

console.log('\n🚀 Creating NexusElite Stripe products...\n');

const results = [];
for (const plan of plans) {
  // Check if product already exists
  const existing = await stripe.products.search({ query: `name:'${plan.name}'`, limit: 1 }).catch(() => ({ data: [] }));

  let product;
  if (existing.data.length > 0) {
    product = existing.data[0];
    console.log(`✅ Product already exists: ${plan.name} (${product.id})`);
  } else {
    product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { nexuselite: 'true' },
    });
    console.log(`✅ Created product: ${plan.name} (${product.id})`);
  }

  // Check if a recurring price exists for this product
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 5 });
  const existing_price = prices.data.find(p => p.recurring?.interval === 'month' && p.unit_amount === plan.amount);

  let price;
  if (existing_price) {
    price = existing_price;
    console.log(`   💰 Price already exists: $${plan.amount / 100}/mo (${price.id})`);
  } else {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amount,
      currency: 'usd',
      recurring: { interval: 'month' },
    });
    console.log(`   💰 Created price: $${plan.amount / 100}/mo (${price.id})`);
  }

  results.push({ ...plan, priceId: price.id });
}

console.log('\n─────────────────────────────────────────────────');
console.log('📋 ADD THESE AS REPLIT SECRETS:\n');
for (const r of results) {
  console.log(`${r.envKey}=${r.priceId}`);
}
console.log('\n─────────────────────────────────────────────────');
console.log('✅ Done! Add the secrets above, then restart the API server.\n');
