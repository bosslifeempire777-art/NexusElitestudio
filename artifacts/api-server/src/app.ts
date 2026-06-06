import express, { type Express } from "express";
import cors from "cors";
import { existsSync } from "fs";
import path from "path";
import router from "./routes";
import { trafficLogger } from "./lib/traffic-log.js";
import { deploymentHost } from "./middleware/deployment-host.js";

const app: Express = express();

app.use(cors());

// Stripe webhook MUST receive raw body — register before express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Capture every /api/* request into the in-memory traffic ring buffer
// so the admin "Live Traffic" panel can show real activity.
app.use(trafficLogger());

// Root healthcheck — registered BEFORE deploymentHost so it never touches
// the database. The deployment platform probes GET / and this guarantees
// an instant 200 even during cold-start or DB warm-up.
// When the built frontend is present the static middleware (below) takes
// over for real browser traffic; this only fires when no other handler ran.
app.get("/", (_req, res, next) => {
  // If the built frontend exists, pass through to the static/SPA middleware below.
  // Otherwise (e.g. healthcheck during cold-start), respond 200 immediately.
  const idx = path.resolve("artifacts/ai-studio/dist/public/index.html");
  if (existsSync(idx)) return next();
  res.status(200).json({ status: "ok" });
});

// Subdomain & custom-domain routing — must run before the API router so
// requests to <slug>.brand.tld or verified custom domains rewrite to
// /api/projects/:id/preview internally.
app.use(deploymentHost());

app.use("/api", router);

// 404 JSON handler for unmatched /api/* routes (must come before static middleware)
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// In production, serve the built AI Studio frontend so the Express server
// handles everything on a single port. This eliminates the need for a
// separate static handler that would block /api/* requests with a catch-all
// rewrite to index.html.
const staticDir = path.resolve("artifacts/ai-studio/dist/public");
if (existsSync(staticDir)) {
  // Serve hashed static assets (JS, CSS, images) with long-lived cache
  app.use(express.static(staticDir, { index: false }));

  // SPA fallback: return index.html for every non-API route so React Router
  // can handle client-side navigation.
  app.get(/^(?!\/api)/, (_req, res, next) => {
    const indexPath = path.join(staticDir, "index.html");
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
}

// Root-level healthcheck fallback — the deployment platform probes GET /
// even when the healthcheck path is configured as /api/healthz. If the
// static frontend hasn't been built yet (or the SPA fallback didn't match),
// return 200 so the healthcheck passes and the server is considered healthy.
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

export default app;
