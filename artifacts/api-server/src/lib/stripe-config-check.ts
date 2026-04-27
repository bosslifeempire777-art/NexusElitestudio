import { getStripeSecretKey, getUncachableStripeClient } from "../stripeClient.js";
import { getWebhookSecrets } from "../webhookHandlers.js";

/**
 * Validate Stripe configuration at startup. This catches the common
 * failure modes that previously slipped silently into production:
 *
 *   1. Test/live key mismatch — e.g. the secret key is `sk_test_…` but
 *      the price IDs in env are live-mode prices, so every checkout
 *      attempt fails with "No such price".
 *   2. A configured price ID does not exist in the same Stripe mode as
 *      the secret key (most often: someone rotated the products and
 *      forgot to update STRIPE_PRICE_*).
 *   3. STRIPE_PRICE_* env vars set to empty strings — the checkout
 *      route would otherwise return `stripe_not_configured` to users
 *      with no log line explaining why.
 *
 * This runs once at boot and only logs (warn / info) — it never throws,
 * because we don't want a misconfigured Stripe to take down the entire
 * API and prevent non-billing endpoints from serving traffic.
 */
export async function checkStripeConfig(): Promise<void> {
  let secretKey: string;
  try {
    secretKey = await getStripeSecretKey();
  } catch (err: any) {
    console.warn("[stripe-config] no Stripe credentials configured:", err?.message ?? err);
    return;
  }

  const keyMode = secretKey.startsWith("sk_live_")
    ? "live"
    : secretKey.startsWith("sk_test_")
      ? "test"
      : "unknown";
  console.log(`[stripe-config] secret key mode = ${keyMode}`);

  // Webhook secret count — production has TWO webhook endpoints registered
  // (one per domain: nexuselitestudio.com and nexuselitestudio.nexus), each
  // with its own signing secret. If the count below is < 2 in production
  // logs, roughly half of incoming webhooks will fail signature verification
  // and plan upgrades after checkout will silently fail. Set both signing
  // secrets via STRIPE_WEBHOOK_SECRET (comma-separated) or via
  // STRIPE_WEBHOOK_SECRET + STRIPE_WEBHOOK_SECRET_2.
  const webhookSecretCount = getWebhookSecrets().length;
  if (webhookSecretCount === 0) {
    console.warn(
      "[stripe-config] NO webhook signing secrets configured — every Stripe " +
        "webhook delivery will be rejected with 4xx and plan upgrades after " +
        "checkout will not apply. Set STRIPE_WEBHOOK_SECRET to the signing " +
        "secret(s) shown on the Stripe Dashboard 'Developers → Webhooks' page.",
    );
  } else {
    console.log(
      `[stripe-config] webhook signing secrets configured = ${webhookSecretCount}`,
    );
  }

  const priceIds: Array<{ name: string; id: string }> = [
    { name: "STARTER", id: process.env.STRIPE_PRICE_STARTER ?? "" },
    { name: "PRO", id: process.env.STRIPE_PRICE_PRO ?? "" },
    { name: "ELITE", id: process.env.STRIPE_PRICE_ELITE ?? "" },
  ];

  const missing = priceIds.filter(p => !p.id);
  if (missing.length > 0) {
    console.warn(
      `[stripe-config] missing STRIPE_PRICE_${missing.map(m => m.name).join(", STRIPE_PRICE_")} ` +
        `— /api/stripe/checkout will return "stripe_not_configured" for these plans.`,
    );
  }

  const configured = priceIds.filter(p => p.id);
  if (configured.length === 0) return;

  let stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err: any) {
    console.warn("[stripe-config] could not create Stripe client:", err?.message ?? err);
    return;
  }

  const results = await Promise.allSettled(
    configured.map(p => stripe.prices.retrieve(p.id)),
  );

  let mismatchCount = 0;
  for (let i = 0; i < configured.length; i++) {
    const { name, id } = configured[i]!;
    const res = results[i]!;
    if (res.status === "rejected") {
      mismatchCount++;
      console.warn(
        `[stripe-config] STRIPE_PRICE_${name} = ${id} → ${res.reason?.message ?? res.reason}. ` +
          `This usually means the price ID belongs to a different Stripe ` +
          `account or was created in a different mode (test vs live) than ` +
          `the current ${keyMode} key.`,
      );
      continue;
    }
    const price = res.value;
    const priceMode = price.livemode ? "live" : "test";
    if (priceMode !== keyMode && keyMode !== "unknown") {
      mismatchCount++;
      console.warn(
        `[stripe-config] STRIPE_PRICE_${name} (${id}) is in ${priceMode} mode ` +
          `but the secret key is in ${keyMode} mode. Checkout will fail.`,
      );
    } else if (!price.active) {
      console.warn(
        `[stripe-config] STRIPE_PRICE_${name} (${id}) exists but is INACTIVE. ` +
          `Reactivate it on the Stripe dashboard or rotate the env var.`,
      );
    } else {
      console.log(
        `[stripe-config] STRIPE_PRICE_${name} = ${id} OK ` +
          `(${price.unit_amount} ${price.currency} ${priceMode})`,
      );
    }
  }
  if (mismatchCount === 0) {
    console.log("✓ stripe-config: all configured prices match the secret key mode");
  }
}
