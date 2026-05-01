// Stripe client — prefers explicit STRIPE_SECRET_KEY env var (live key set by
// the operator) over the Replit connector, which supplies a test key.
// WARNING: Never cache the client — tokens expire. Always call getUncachableStripeClient() fresh.
import Stripe from 'stripe';

async function getCredentials() {
  // ── Priority 1: explicit env var (set in Replit Secrets by the operator) ──
  // This is always preferred because the Replit Stripe connector supplies a
  // TEST key even in production, while the prices were created in live mode.
  const envSecret = process.env.STRIPE_SECRET_KEY;
  const envPublishable = process.env.STRIPE_PUBLISHABLE_KEY || '';
  if (envSecret) {
    return { secretKey: envSecret, publishableKey: envPublishable };
  }

  // ── Priority 2: Replit connector (fallback for local dev without env var) ──
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in Replit Secrets or connect your Stripe account via the integration.');
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
    throw new Error(`Stripe ${targetEnvironment} connection not found. Connect your Stripe account or set STRIPE_SECRET_KEY.`);
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
