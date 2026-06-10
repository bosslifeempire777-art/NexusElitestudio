import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Applies all application table DDL to the connected PostgreSQL database
 * using CREATE TABLE IF NOT EXISTS — safe and idempotent on every boot.
 *
 * This runs inside Render's infrastructure against the internal DATABASE_URL,
 * so it works even when the Render DB IP allow-list blocks external pushes.
 * It replaces the need to run `drizzle-kit push` manually from outside.
 */
export async function ensureMainSchema(): Promise<void> {
  try {
    // Run each statement individually so a partial failure gives a clear error.

    // ----------------------------------------------------------------
    // users
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id                       TEXT PRIMARY KEY,
        username                 TEXT NOT NULL UNIQUE,
        email                    TEXT UNIQUE,
        password_hash            TEXT,
        plan                     TEXT NOT NULL DEFAULT 'free',
        is_admin                 BOOLEAN NOT NULL DEFAULT FALSE,
        is_vip                   BOOLEAN NOT NULL DEFAULT FALSE,
        project_count            INTEGER NOT NULL DEFAULT 0,
        builds_this_month        INTEGER NOT NULL DEFAULT 0,
        stripe_customer_id       TEXT,
        stripe_subscription_id   TEXT,
        referral_code            TEXT UNIQUE,
        credit_balance           INTEGER NOT NULL DEFAULT 0,
        last_recovery_email_at   TIMESTAMP,
        recovery_email_sent_plan TEXT,
        recovery_converted_at    TIMESTAMP,
        created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // projects
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS projects (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT,
        type           TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'building',
        prompt         TEXT NOT NULL,
        framework      TEXT,
        game_engine    TEXT,
        user_id        TEXT NOT NULL,
        thumbnail_url  TEXT,
        deployed_url   TEXT,
        agent_logs     JSONB NOT NULL DEFAULT '[]',
        chat_history   JSONB NOT NULL DEFAULT '[]',
        memory         JSONB NOT NULL DEFAULT '{}',
        generated_code TEXT,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // deployments
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS deployments (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL,
        user_id             TEXT NOT NULL,
        slug                TEXT NOT NULL UNIQUE,
        branded_url         TEXT NOT NULL,
        provider            TEXT NOT NULL DEFAULT 'nexus-edge',
        provider_service_id TEXT,
        provider_live_url   TEXT,
        status              TEXT NOT NULL DEFAULT 'live',
        error_message       TEXT,
        build_logs          JSONB NOT NULL DEFAULT '[]',
        last_deployed_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // custom_domains
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS custom_domains (
        id                  TEXT PRIMARY KEY,
        deployment_id       TEXT NOT NULL,
        user_id             TEXT NOT NULL,
        domain              TEXT NOT NULL UNIQUE,
        status              TEXT NOT NULL DEFAULT 'pending',
        verification_target TEXT,
        verified_at         TIMESTAMP,
        last_checked_at     TIMESTAMP,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // builds
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS builds (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'queued',
        started_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        logs         JSONB NOT NULL DEFAULT '[]',
        deployed_url TEXT
      )
    `);

    // ----------------------------------------------------------------
    // build_logs
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS build_logs (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        level      TEXT NOT NULL DEFAULT 'info',
        message    TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        timestamp  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // marketplace_listings
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS marketplace_listings (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL,
        title         TEXT NOT NULL,
        description   TEXT NOT NULL,
        category      TEXT NOT NULL,
        price         REAL NOT NULL DEFAULT 0,
        is_free       BOOLEAN NOT NULL DEFAULT FALSE,
        seller_id     TEXT NOT NULL,
        seller_name   TEXT NOT NULL,
        downloads     INTEGER NOT NULL DEFAULT 0,
        rating        REAL NOT NULL DEFAULT 0,
        thumbnail_url TEXT,
        tags          JSONB NOT NULL DEFAULT '[]',
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // characters
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS characters (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        game_style TEXT NOT NULL DEFAULT 'cartoon',
        prompt     TEXT NOT NULL DEFAULT '',
        image_url  TEXT,
        image_data TEXT,
        image_type TEXT NOT NULL DEFAULT 'ai-generated',
        user_id    TEXT NOT NULL,
        project_id TEXT,
        tags       TEXT[],
        notes      TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // ai_lab_packs
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_lab_packs (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL,
        prompts_total     INTEGER NOT NULL,
        prompts_remaining INTEGER NOT NULL,
        amount_paid_cents INTEGER NOT NULL DEFAULT 0,
        stripe_session_id TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // ai_lab_runs
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_lab_runs (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL,
        project_id       TEXT,
        prompt           TEXT NOT NULL,
        mode             TEXT NOT NULL DEFAULT 'single',
        app_type         TEXT,
        models           JSONB NOT NULL DEFAULT '[]',
        responses        JSONB NOT NULL DEFAULT '[]',
        prompts_consumed INTEGER NOT NULL DEFAULT 1,
        duration_ms      INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // custom_agents  (Command Center)
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS custom_agents (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        icon          TEXT NOT NULL DEFAULT '🤖',
        category      TEXT NOT NULL DEFAULT 'custom',
        model         TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        capabilities  JSONB NOT NULL DEFAULT '[]',
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_by    TEXT NOT NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // agent_model_assignments  (Command Center)
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_model_assignments (
        agent_id   TEXT PRIMARY KEY,
        model      TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // console_history  (Command Center)
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS console_history (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        command     TEXT NOT NULL,
        exit_code   TEXT,
        stdout      TEXT NOT NULL DEFAULT '',
        stderr      TEXT NOT NULL DEFAULT '',
        duration_ms TEXT,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // referral_status enum + referrals + credit_transactions
    // ----------------------------------------------------------------
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE referral_status AS ENUM ('pending', 'converted');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referrals (
        id                 TEXT PRIMARY KEY,
        referrer_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referred_id        TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        status             referral_status NOT NULL DEFAULT 'pending',
        plan_at_conversion TEXT,
        created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        converted_at       TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount      INTEGER NOT NULL,
        type        TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // usage_records
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS usage_records (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        project_id  TEXT,
        kind        TEXT NOT NULL,
        units       INTEGER NOT NULL DEFAULT 1,
        tokens_in   INTEGER NOT NULL DEFAULT 0,
        tokens_out  INTEGER NOT NULL DEFAULT 0,
        cost_cents  INTEGER NOT NULL DEFAULT 0,
        model       TEXT,
        description TEXT,
        paid        INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // overage_credits
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS overage_credits (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL,
        builds            INTEGER NOT NULL DEFAULT 0,
        builds_used       INTEGER NOT NULL DEFAULT 0,
        amount_paid_cents INTEGER NOT NULL DEFAULT 0,
        stripe_session_id TEXT,
        status            TEXT NOT NULL DEFAULT 'active',
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // user_secrets
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_secrets (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        name        TEXT NOT NULL,
        value       TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT 'general',
        description TEXT,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS user_secrets_user_name_uq
        ON user_secrets (user_id, name)
    `);

    // ----------------------------------------------------------------
    // recovery_email_events
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recovery_email_events (
        id        TEXT PRIMARY KEY,
        user_id   TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        sent_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // Column migrations — ADD COLUMN IF NOT EXISTS is idempotent so
    // these run safely on every boot against both fresh and existing DBs.
    // ----------------------------------------------------------------
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_recovery_email_at   TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email_sent_plan TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_converted_at    TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code            TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_balance           INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS generated_code TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS memory         JSONB NOT NULL DEFAULT '{}'`);

    // ----------------------------------------------------------------
    // project_app_data — platform-hosted backend database for generated apps.
    // Generated apps call GET/POST/PUT/DELETE /api/projects/:id/appdata/:collection
    // and this table stores the results in real PostgreSQL.
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS project_app_data (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        doc_id     TEXT NOT NULL,
        data       JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS project_app_data_uq
        ON project_app_data (project_id, collection, doc_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS project_app_data_collection_idx
        ON project_app_data (project_id, collection)
    `);

    // ----------------------------------------------------------------
    // EAS platform tables — mobile builds and webhook registrations
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mobile_builds (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL,
        eas_build_id  TEXT NOT NULL,
        platform      TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'in-queue',
        profile       TEXT NOT NULL DEFAULT 'preview',
        artifact_url  TEXT,
        repo_url      TEXT,
        logs_url      TEXT,
        error_message TEXT,
        started_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        finished_at   TIMESTAMP,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mobile_builds_project_idx
        ON mobile_builds (project_id, created_at DESC)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS eas_webhooks (
        id             TEXT PRIMARY KEY,
        project_id     TEXT NOT NULL,
        url            TEXT NOT NULL,
        secret         TEXT,
        events         JSONB NOT NULL DEFAULT '["BUILD"]',
        active         BOOLEAN NOT NULL DEFAULT TRUE,
        eas_webhook_id TEXT,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS eas_webhooks_project_idx
        ON eas_webhooks (project_id)
    `);

    // ----------------------------------------------------------------
    // project_app_secrets — per-app key/value secrets for generated apps.
    // Injected as window.APP_SECRETS in the preview (owner-only).
    // Separate from user_secrets (which are the platform owner's global keys).
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS project_app_secrets (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name       TEXT NOT NULL,
        value      TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS project_app_secrets_uq
        ON project_app_secrets (project_id, name)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS project_app_secrets_project_idx
        ON project_app_secrets (project_id)
    `);

    // ----------------------------------------------------------------
    // swarm_mode column on projects (added after initial schema)
    // ----------------------------------------------------------------
    await db.execute(sql`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS swarm_mode TEXT DEFAULT 'genesis'
    `);

    // ----------------------------------------------------------------
    // swarm_tier_config — editable model fallback chains for Hydra swarm
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS swarm_tier_config (
        tier        TEXT PRIMARY KEY,
        models      JSONB NOT NULL DEFAULT '[]',
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_by  TEXT
      )
    `);

    // ----------------------------------------------------------------
    // swarm_role_config — per-role model overrides for ROLE_REGISTRY
    // ----------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS swarm_role_config (
        tier         TEXT NOT NULL,
        role         TEXT NOT NULL,
        primary_slug TEXT NOT NULL,
        fallbacks    JSONB NOT NULL DEFAULT '[]',
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_by   TEXT,
        PRIMARY KEY (tier, role)
      )
    `);

    console.log("✓ Main application schema verified / applied");
  } catch (err: any) {
    console.error("[ensure-schema] Failed to apply schema:", err?.message ?? err);
    throw err;
  }
}
