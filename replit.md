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

## Design

Dark cyberpunk aesthetic: deep black backgrounds, cyan/pink/magenta neon accents, monospace fonts, grid patterns, terminal-style headers. Brand name: "Nexus Studio".
