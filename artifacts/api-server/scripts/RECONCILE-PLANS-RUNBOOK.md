# Runbook: reconcile-plans on production

One-shot recovery for users whose `users.plan` got stuck on `free` because
the production webhook endpoint was rejecting half of all
`checkout.session.completed` deliveries (missing second-domain signing
secret). The script walks every user with a `stripe_customer_id`, asks
Stripe what they're actually subscribed to, and aligns our DB.

Source: `artifacts/api-server/scripts/reconcile-plans.ts`

---

## 0. Pre-flight (do not skip)

All of these MUST be true before you run anything. If any are false, stop.

- [ ] The Render redeploy with the multi-secret webhook code is **live**.
      Verify by hitting the health endpoint and checking the deployed
      commit SHA matches `main`. If the "Get the live site actually
      starting up" task is still open, this whole runbook is premature —
      the new webhook code isn't running, and you'll just have to redo
      this after it ships.
- [ ] On Render, BOTH webhook signing secrets are set. The app reads them
      from any of: `STRIPE_WEBHOOK_SECRET` (comma-separated OK),
      `STRIPE_WEBHOOK_SECRETS`, or `STRIPE_WEBHOOK_SECRET_2..5`. There
      should be one secret per registered endpoint in the Stripe
      dashboard (today: `nexuselitestudio.com` and
      `nexuselitestudio.nexus`).
- [ ] You have the **production** `DATABASE_URL` (not staging, not dev).
      Sanity check: it should be the same DSN Render is using for the
      live API.
- [ ] You have `STRIPE_SECRET_KEY` for the **live** Stripe account, plus
      `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`
      pointing at **live-mode** price IDs. If these are test-mode IDs,
      the script will think every paying customer should be downgraded.
      The script aborts if none are set, but it cannot detect a
      test-vs-live mismatch — you have to.
- [ ] You're running this from a checkout of `main` that contains
      `artifacts/api-server/scripts/reconcile-plans.ts`.
- [ ] Dependencies installed: `pnpm install` at the repo root.

## 1. Take a backup

Snapshot `users` (at minimum the columns the script touches) before any
write. Pick whichever is easiest in your hosting setup:

```bash
# Option A: full DB dump
pg_dump "$PROD_DATABASE_URL" > backup-users-$(date +%Y%m%d-%H%M%S).sql

# Option B: just the relevant columns
psql "$PROD_DATABASE_URL" -c \
  "\copy (select id, username, plan, stripe_customer_id, stripe_subscription_id from users) \
   to 'users-before-$(date +%Y%m%d-%H%M%S).csv' csv header"
```

Keep the file. This is your rollback if anything looks wrong after apply.

## 2. Dry run

Default mode is dry-run; no DB writes happen. Capture the output to a
file — this IS the audit trail the task asks for.

```bash
export DATABASE_URL='<prod connection string>'
export STRIPE_SECRET_KEY='sk_live_...'
export STRIPE_PRICE_STARTER='price_live_...'
export STRIPE_PRICE_PRO='price_live_...'
export STRIPE_PRICE_ELITE='price_live_...'

REPORT="reconcile-dryrun-$(date +%Y%m%d-%H%M%S).log"
pnpm --filter @workspace/api-server reconcile-plans 2>&1 | tee "$REPORT"
```

The tail of the report looks like:

```
=== reconcile-plans report ===
mode:              DRY-RUN (no DB writes)
users scanned:     N
planned upgrades:  X
planned downgrades:Y
unchanged:         ...
protected (vip):   ...
stripe customer missing: ...
errors:            0
changes:
  - <username> (<userId>) cust=<cus_…>  free -> pro  [Stripe sub sub_… (active) maps to 'pro']  [dry-run]
  ...
```

## 3. Review the dry-run

Walk the `changes:` list and sanity-check:

- [ ] `errors: 0`. Anything else, stop and investigate before applying.
- [ ] Upgrades dominate. The whole point of this exercise is recovering
      paid buyers stuck on `free`. You should see a chunk of
      `free -> starter|pro|elite` lines.
- [ ] Downgrades are zero or very small. The script's safety guard
      aborts apply mode if planned downgrades > 5. If it's planning a
      lot of downgrades on a healthy webhook, the env vars are probably
      wrong (test vs live mode, or stale price IDs). Do not bypass the
      guard until you've explained the downgrades.
- [ ] `protected (vip)` count matches what you expect (admin/comp accounts
      are intentionally never touched).
- [ ] Spot-check 2–3 of the planned upgrades against the Stripe dashboard:
      open the customer in Stripe, confirm the active subscription's price
      really does map to the destination plan.

If any of those fail, stop. Don't apply.

## 4. Apply

Only after the dry run review passes. Same env, add `--apply`.

```bash
APPLY_REPORT="reconcile-apply-$(date +%Y%m%d-%H%M%S).log"
pnpm --filter @workspace/api-server reconcile-plans -- --apply 2>&1 | tee "$APPLY_REPORT"
```

If the safety guard trips (`ABORT: planned N downgrades exceeds safety
limit 5`) and you've genuinely reviewed and accepted the downgrades, the
override is:

```bash
pnpm --filter @workspace/api-server reconcile-plans -- --apply --max-downgrades=<N>
```

Confirm the tail of the apply log shows `applied upgrades` / `applied
downgrades` matching the `planned` numbers from the dry run, and
`errors: 0`.

## 5. Spot-check in the admin panel

Pick 1–2 users from the `applied upgrades` list and open them in the
admin UI. Confirm:

- [ ] Their plan badge now matches the plan they paid for.
- [ ] `stripe_subscription_id` is populated and matches the `sub_…` ID
      from the report.

## 6. Save the audit trail

Keep both `$REPORT` (dry run) and `$APPLY_REPORT` (apply) somewhere
durable — internal docs, a private Drive folder, or attached to the
project task before closing. Together they document: who was changed,
from what to what, why (which Stripe sub justified the change), and
when.

## 7. Rollback (only if needed)

If the apply went bad, restore the backup from step 1. The script is
idempotent and read-only against Stripe, so re-running it after fixing
the underlying issue (env vars, etc.) is safe.

```bash
# from CSV backup, per-user:
psql "$PROD_DATABASE_URL" -c \
  "update users set plan='<old>', stripe_subscription_id='<old>' where id='<id>'"
```

---

## Quick reference

| Step | Command |
| --- | --- |
| Dry run | `pnpm --filter @workspace/api-server reconcile-plans` |
| Apply | `pnpm --filter @workspace/api-server reconcile-plans -- --apply` |
| Apply with raised guard | `... -- --apply --max-downgrades=N` |

Exit codes: `0` clean, `1` errors during run, `2` no price env vars set
(refused to run), `3` safety guard tripped on downgrades.
