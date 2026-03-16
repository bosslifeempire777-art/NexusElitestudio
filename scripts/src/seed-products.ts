import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();
    console.log('Creating AI Studio Platform subscription plans in Stripe...');

    // --- PRO PLAN ---
    const existingPro = await stripe.products.search({
      query: "name:'Nexus Studio Pro' AND active:'true'"
    });

    let proProduct;
    if (existingPro.data.length > 0) {
      console.log('Pro Plan already exists, skipping.');
      proProduct = existingPro.data[0];
    } else {
      proProduct = await stripe.products.create({
        name: 'Nexus Studio Pro',
        description: 'Unlimited builds, 50 projects, full deployment access, all AI agents, game studio mode.',
        metadata: { plan: 'pro' },
      });
      console.log(`Created Pro product: ${proProduct.id}`);

      await stripe.prices.create({
        product: proProduct.id,
        unit_amount: 4900,
        currency: 'usd',
        recurring: { interval: 'month' },
        metadata: { plan: 'pro', billing: 'monthly' },
      });
      console.log('Created Pro monthly price: $49/month');

      await stripe.prices.create({
        product: proProduct.id,
        unit_amount: 49000,
        currency: 'usd',
        recurring: { interval: 'year' },
        metadata: { plan: 'pro', billing: 'yearly' },
      });
      console.log('Created Pro yearly price: $490/year');
    }

    // --- ENTERPRISE PLAN ---
    const existingEnterprise = await stripe.products.search({
      query: "name:'Nexus Studio Enterprise' AND active:'true'"
    });

    if (existingEnterprise.data.length > 0) {
      console.log('Enterprise Plan already exists, skipping.');
    } else {
      const enterpriseProduct = await stripe.products.create({
        name: 'Nexus Studio Enterprise',
        description: 'Unlimited everything, team collaboration, private infrastructure, SLA guarantee, custom AI models.',
        metadata: { plan: 'enterprise' },
      });
      console.log(`Created Enterprise product: ${enterpriseProduct.id}`);

      await stripe.prices.create({
        product: enterpriseProduct.id,
        unit_amount: 19900,
        currency: 'usd',
        recurring: { interval: 'month' },
        metadata: { plan: 'enterprise', billing: 'monthly' },
      });
      console.log('Created Enterprise monthly price: $199/month');

      await stripe.prices.create({
        product: enterpriseProduct.id,
        unit_amount: 199000,
        currency: 'usd',
        recurring: { interval: 'year' },
        metadata: { plan: 'enterprise', billing: 'yearly' },
      });
      console.log('Created Enterprise yearly price: $1,990/year');
    }

    console.log('\n✅ All products and prices created successfully!');
    console.log('Webhooks will sync this data to your database automatically.');
  } catch (error: any) {
    console.error('Error creating products:', error.message);
    process.exit(1);
  }
}

createProducts();
