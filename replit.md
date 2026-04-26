# AI Studio Platform

## Overview

An autonomous AI-powered development platform (Nexus Studio) capable of building websites, mobile apps, SaaS platforms, automation systems, AI tools, and fully playable video games. Functions as a complete AI software factory and game studio with a dark cyberpunk aesthetic.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/ai-studio), Tailwind CSS, Framer Motion, Recharts, Lucide React
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── ai-studio/          # Main platform frontend (React + Vite)
│   └── api-server/         # Express API server
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
└── scripts/                # Utility scripts
```

## AI Studio Platform Features

### Pages
- **Landing Page** (`/`) - Hero with prompt input, feature showcase, stats
- **Dashboard** (`/dashboard`) - "Command Center" with user project grid, usage metrics
- **Project Builder** (`/projects/new`) - Natural language prompt input with project type selector
- **Project Detail** (`/projects/:id`) - File tree, code editor, agent logs, live preview
- **Agent Swarm** (`/agents`) - Grid of 21 AI agents categorized by type
- **Marketplace** (`/marketplace`) - "Nexus Exchange" with published apps/games/tools
- **Admin Console** (`/admin`) - "Overseer Terminal" with analytics charts and user management
- **Settings** (`/settings`) - Profile, plan management, API keys
- **Pricing** (`/pricing`) - Plan comparison: Free / Pro ($49) / Enterprise ($199) / VIP

### Agent Swarm (21 Agents)
Categories: Software, DevOps, Design, Security, Database, Game Studio, Business

Software: Central Orchestrator, Software Architect, Code Generator, Auto Code Repair, Testing Agent, AI Integration Agent
Game Studio: Game Designer, Game Engine Agent, Asset Generator, Level Builder, Game Physics, Multiplayer Network, Game Testing
Business: AI Startup Builder, AI Marketing, AI Sales, Analytics Agent
DevOps: DevOps Agent
Design: UI/UX Design Agent
Security: Security Agent
Database: Database Agent

### Project Types
- Website, Mobile App, SaaS, Automation, AI Tool, Game (with engine selection: Godot/Unity/Unreal)

### Subscription Plans
- **Free**: 5 builds/month, 3 projects, limited deployment
- **Pro ($49/mo)**: Unlimited builds, 50 projects, full deployment, game studio
- **Enterprise ($199/mo)**: Unlimited everything, team collab, private infra
- **VIP**: Full free access, owner-assigned

## API Routes

- `GET /api/auth/me` - Get current user
- `GET/POST /api/projects` - List/create projects
- `GET/DELETE /api/projects/:id` - Get/delete project
- `GET /api/projects/:id/build-logs` - Build logs
- `GET /api/projects/:id/files` - File tree
- `GET /api/agents` - List agents
- `POST /api/agents/:id/run` - Run agent
- `GET /api/builds` - List builds
- `GET /api/marketplace/listings` - Marketplace items
- `POST /api/marketplace/listings` - Publish listing
- `GET /api/users` - User management (admin)
- `POST /api/users/:id/grant-vip` - Grant VIP access
- `GET /api/plans` - Subscription plans
- `GET /api/analytics/overview` - Admin analytics
- `GET /api/analytics/user` - User analytics

## Database Schema

- `users` - User accounts with plan, VIP, admin fields
- `projects` - Project metadata with type, status, agent logs
- `builds` - Build history and status
- `build_logs` - Detailed build log entries
- `marketplace_listings` - Published marketplace items

## Stripe Payments (Live)

Stripe is live in production. Account: `acct_1TBYzAJuLDzBrGo8` (US, USD,
charges and payouts enabled, fully onboarded).

### Configuration
- Secrets: `STRIPE_SECRET_KEY` (`sk_live_…`), `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`)
- Shared env: `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`
  — all three IDs exist in live mode and map to active recurring monthly
  prices ($29 / $60 / $269) on the `NexusElite` products.
- Webhook signing secret: `STRIPE_WEBHOOK_SECRET`. **Comma-separate
  multiple secrets** (e.g. `whsec_a,whsec_b`) when more than one webhook
  endpoint is registered on the Stripe dashboard. Numbered fallbacks
  `STRIPE_WEBHOOK_SECRET_2…5` and `STRIPE_WEBHOOK_SECRETS` are also
  honored. The handler (`webhookHandlers.ts`) tries each secret in turn.

### Webhook endpoints (live)
Two endpoints are registered on the Stripe dashboard, one per domain:
- `https://nexuselitestudio.com/api/stripe/webhook`
- `https://nexuselitestudio.nexus/api/stripe/webhook`

Each endpoint has its own signing secret. Both must be put into
`STRIPE_WEBHOOK_SECRET` (comma-separated) so signature verification
succeeds for events from either endpoint. Otherwise roughly half of all
webhook deliveries fail signature verification and the user's plan is
never updated after checkout.

### Routes
- `GET  /api/stripe/products-with-prices`
- `POST /api/stripe/checkout`
- `POST /api/stripe/portal`
- `GET  /api/stripe/subscription`
- `POST /api/stripe/webhook` — must be registered **before** `express.json()`
  in `app.ts` so the raw `Buffer` body is preserved for signature
  verification. Returns **400** on signature failure (so Stripe will
  retry the delivery), not 200.

### Known noisy warning (non-fatal)
The `stripe-replit-sync` package logs `relation "stripe.accounts" does not
exist` / `relation "stripe._managed_webhooks" does not exist` on every
incoming webhook in production. The package expects its own `stripe.*`
schema in the database but it has never been migrated on the prod DB.
Plan upgrades still work because our own `webhookHandlers.ts` runs
independently of the sync step.

### Investigation history
On 2026-04-26 the owner reported "lots of declined payments" with no
successful charges. Investigation against the live Stripe account
revealed: only **1 actual charge attempt** in the last 30 days (declined
for `insufficient_funds` — a real customer card issue) and **5 expired
checkout sessions** where the customer abandoned the form. The "many
declines" perception was abandoned-checkout sessions in the dashboard,
not configuration failures. The configuration issues that *were* found —
multi-endpoint webhook signature mismatches and silent 200 OK responses
on signature failure — are now fixed in `webhookHandlers.ts` and
`routes/stripe.ts`.

## Design

Dark cyberpunk aesthetic: deep black backgrounds, cyan/pink/magenta neon accents, monospace fonts, grid patterns, terminal-style headers. Brand name: "Nexus Studio".
