// Stripe client via Replit Connector (stripe + stripe-replit-sync)
// WARNING: Never cache the client — tokens expire. Always call getUncachableStripeClient() fresh.
import Stripe from 'stripe';

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  // Fallback: use STRIPE_SECRET_KEY env var if Replit connector is not available
  if (!hostname || !xReplitToken) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('Stripe is not configured. Connect your Stripe account via the Replit integration or set STRIPE_SECRET_KEY.');
    }
    return { secretKey: apiKey, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' };
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Replit-Token': xReplitToken,
    },
  });

  const data = (await response.json()) as {
    items?: Array<{
      settings?: { secret?: string; publishable?: string };
    }>;
  };
  const connectionSettings = data.items?.[0];

  if (!connectionSettings?.settings?.secret) {
    // Second fallback to env var
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (apiKey) return { secretKey: apiKey, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' };
    throw new Error(`Stripe ${targetEnvironment} connection not found. Connect your Stripe account.`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable as string,
    secretKey: connectionSettings.settings.secret as string,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, { apiVersion: '2025-11-17.clover' });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
  return secretKey;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();
    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
