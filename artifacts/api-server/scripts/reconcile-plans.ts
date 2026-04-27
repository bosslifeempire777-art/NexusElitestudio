/**
 * One-shot reconciliation: align our `users.plan` column with the actual
 * subscription state in Stripe.
 *
 * Why this exists:
 *   For weeks before the multi-secret webhook fix, roughly half of every
 *   `checkout.session.completed` delivery failed signature verification on
 *   production (the second domain's webhook signing secret was missing
 *   from the Render env). Buyers paid Stripe successfully but our
 *   `users.plan` column was never updated, leaving them stuck on `free`.
 *
 * What this does:
 *   1. Loads every user row that has a non-null `stripeCustomerId`.
 *   2. For each, asks Stripe for that customer's current subscriptions.
 *   3. If the customer has an active/trialing subscription whose price ID
 *      maps to one of our plans (starter / pro / elite), updates the user
 *      to that plan + records the subscription ID.
 *   4. If the customer has NO active subscription but our DB still shows
 *      a paid plan, downgrades them to `free` (unless they're on `vip`
 *      which is the manually-granted admin/comp plan — never auto-touch).
 *   5. Prints a short report at the end.
 *
 * Safety:
 *   - Read-only against Stripe (`subscriptions.list`, `customers.retrieve`).
 *   - Never creates / modifies / cancels a subscription. No charges.
 *   - Default mode is DRY-RUN. You must pass `--apply` to actually write the DB.
 *   - `--max-downgrades=N` aborts before writing if the planned downgrade
 *     count exceeds N. Default 5. Catches misconfigured envs that would
 *     wrongly mass-downgrade real customers.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server reconcile-plans                       # dry-run (default)
 *   pnpm --filter @workspace/api-server reconcile-plans -- --apply
 *   pnpm --filter @workspace/api-server reconcile-plans -- --apply --max-downgrades=20
 */
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { isNotNull } from "drizzle-orm";
import {
  getUncachableStripeClient,
} from "../src/stripeClient.js";
import {
  priceToPlan,
  setUserPlan,
} from "../src/webhookHandlers.js";

// Default to DRY-RUN. Apply mode must be explicit.
const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;
const PROTECTED_PLANS = new Set(["vip", "admin"]);
const PAID_PLANS = new Set(["starter", "pro", "elite"]);

function parseMaxDowngrades(): number {
  const arg = process.argv.find((a) => a.startsWith("--max-downgrades="));
  if (!arg) return 5;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}
const MAX_DOWNGRADES = parseMaxDowngrades();

interface ReportRow {
  userId: string;
  username: string;
  customerId: string;
  before: string;
  after: string;
  derivedSubId: string | null;
  reason: string;
  applied: boolean;
}

async function main() {
  const stripe = await getUncachableStripeClient();
  const map = priceToPlan();
  const knownPriceIds = new Set(
    Object.keys(map).filter((k) => !k.startsWith("__none")),
  );
  if (knownPriceIds.size === 0) {
    console.error(
      "[reconcile-plans] No STRIPE_PRICE_STARTER/PRO/ELITE env vars set; refusing to run (would think every user should be downgraded).",
    );
    process.exit(2);
  }

  console.log(
    `[reconcile-plans] mode=${DRY_RUN ? "DRY-RUN" : "APPLY"}  known prices=${knownPriceIds.size}`,
  );

  const candidates = await db
    .select()
    .from(usersTable)
    .where(isNotNull(usersTable.stripeCustomerId));

  console.log(
    `[reconcile-plans] found ${candidates.length} user(s) with a stripe_customer_id`,
  );

  const report: ReportRow[] = [];
  let scanned = 0;
  let upgraded = 0;
  let downgraded = 0;
  let unchanged = 0;
  let skippedProtected = 0;
  let skippedNoCustomer = 0;
  let errors = 0;

  for (const user of candidates) {
    scanned++;
    const customerId = user.stripeCustomerId!;
    const username = user.username ?? "(no-username)";

    if (PROTECTED_PLANS.has(user.plan)) {
      skippedProtected++;
      continue;
    }

    // Query 'active' and 'trialing' DIRECTLY (not via status='all' with a
    // small page size). A long-tenured customer can have dozens of
    // canceled / incomplete records; if the live subscription falls off
    // the first page we'd wrongly conclude they have nothing active and
    // downgrade them. Auto-paginate within each status to be safe.
    type Sub = Awaited<ReturnType<typeof stripe.subscriptions.list>>["data"][number];
    const liveSubs: Sub[] = [];
    try {
      for (const status of ["active", "trialing"] as const) {
        for await (const s of stripe.subscriptions.list({
          customer: customerId,
          status,
          limit: 100,
        })) {
          liveSubs.push(s);
        }
      }
    } catch (err: any) {
      // Customer was deleted on Stripe, or the customer ID belongs to a
      // different mode (test vs live). Either way, leave the user alone —
      // we don't have enough information to safely change their plan.
      const code = err?.code ?? err?.statusCode;
      if (code === "resource_missing" || err?.statusCode === 404) {
        skippedNoCustomer++;
        continue;
      }
      console.error(
        `[reconcile-plans] error fetching subs for ${user.id} (${customerId}):`,
        err?.message ?? err,
      );
      errors++;
      continue;
    }

    // Pick the most recent subscription that is currently providing access.
    const liveSub = liveSubs.sort(
      (a, b) => (b.created ?? 0) - (a.created ?? 0),
    )[0];

    let derivedPlan = "free";
    let derivedSubId: string | null = null;

    if (liveSub) {
      const items = liveSub.items?.data ?? [];
      // Find the FIRST item whose price we recognize. (We don't currently
      // sell multi-line subscriptions, but if one shows up, prefer the
      // matched line over an unknown one.)
      const matchedItem =
        items.find((it) => knownPriceIds.has(it.price?.id ?? "")) ??
        items[0];
      const priceId = matchedItem?.price?.id ?? "";
      if (knownPriceIds.has(priceId)) {
        derivedPlan = map[priceId] ?? "free";
        derivedSubId = liveSub.id;
      } else {
        // Active subscription, but its price isn't one of ours. Could mean
        // a stale legacy product, or the env vars on this machine don't
        // match the env that wrote the subscription. Don't change plan;
        // log and move on.
        console.warn(
          `[reconcile-plans] user ${user.id} has active sub ${liveSub.id} on unknown price ${priceId} — leaving plan='${user.plan}' alone`,
        );
        unchanged++;
        continue;
      }
    }

    const wantsChange =
      derivedPlan !== user.plan ||
      (derivedSubId !== null && derivedSubId !== user.stripeSubscriptionId);

    if (!wantsChange) {
      unchanged++;
      continue;
    }

    // Be extra cautious about downgrades: only downgrade users whose
    // current DB plan is one of the paid plans we know how to grant. Never
    // strip a `vip` (already filtered above) or some unknown custom plan.
    if (derivedPlan === "free" && !PAID_PLANS.has(user.plan)) {
      unchanged++;
      continue;
    }

    const reason = liveSub
      ? `Stripe sub ${liveSub.id} (${liveSub.status}) maps to '${derivedPlan}'`
      : "no active Stripe subscription";

    // Plan only — increment "applied" counters (upgraded/downgraded) only
    // after the DB write actually succeeds, in the second pass below.
    report.push({
      userId: user.id,
      username,
      customerId,
      before: user.plan,
      after: derivedPlan,
      derivedSubId,
      reason,
      applied: false,
    });
  }

  // Mass-downgrade guard: a misconfigured env (e.g. STRIPE_PRICE_* pointing
  // at the wrong mode, or a transient Stripe outage that returns empty
  // subscription lists) could cause this script to plan a flood of false
  // downgrades. Refuse to apply if the planned downgrades exceed the
  // configured safety threshold.
  const plannedDowngrades = report.filter((r) => r.after === "free").length;
  const plannedUpgrades = report.length - plannedDowngrades;

  if (APPLY && plannedDowngrades > MAX_DOWNGRADES) {
    console.error(
      `[reconcile-plans] ABORT: planned ${plannedDowngrades} downgrades exceeds safety limit ${MAX_DOWNGRADES}.`,
    );
    console.error(
      `  If this is genuinely intended, re-run with --max-downgrades=${plannedDowngrades}.`,
    );
    process.exit(3);
  }

  // Apply phase — DB writes only happen here, and only on success do we
  // bump the upgraded/downgraded tallies.
  for (const r of report) {
    if (DRY_RUN) continue;
    try {
      await setUserPlan(r.userId, r.after, r.derivedSubId, r.customerId);
      r.applied = true;
      if (r.after === "free") downgraded++;
      else upgraded++;
    } catch (err: any) {
      console.error(
        `[reconcile-plans] DB update failed for ${r.userId}:`,
        err?.message ?? err,
      );
      errors++;
    }
  }

  console.log("");
  console.log("=== reconcile-plans report ===");
  console.log(`mode:              ${DRY_RUN ? "DRY-RUN (no DB writes)" : "APPLY"}`);
  console.log(`users scanned:     ${scanned}`);
  console.log(`planned upgrades:  ${plannedUpgrades}`);
  console.log(`planned downgrades:${plannedDowngrades}`);
  if (!DRY_RUN) {
    console.log(`applied upgrades:  ${upgraded}`);
    console.log(`applied downgrades:${downgraded}`);
  }
  console.log(`unchanged:         ${unchanged}`);
  console.log(`protected (vip):   ${skippedProtected}`);
  console.log(`stripe customer missing: ${skippedNoCustomer}`);
  console.log(`errors:            ${errors}`);
  if (report.length > 0) {
    console.log("");
    console.log("changes:");
    for (const r of report) {
      console.log(
        `  - ${r.username} (${r.userId}) cust=${r.customerId}  ${r.before} -> ${r.after}  [${r.reason}]${r.applied ? "" : DRY_RUN ? "  [dry-run]" : "  [NOT APPLIED]"}`,
      );
    }
  }
  if (DRY_RUN && report.length > 0) {
    console.log("");
    console.log("Re-run with --apply to actually write these changes to the database.");
  }

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[reconcile-plans] fatal:", err?.stack ?? err);
  process.exit(1);
});
