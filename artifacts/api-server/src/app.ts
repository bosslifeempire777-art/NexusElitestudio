import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { existsSync, createReadStream } from "fs";
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

// Root route — registered BEFORE deploymentHost so it NEVER touches the DB.
// Uses a raw Node.js read stream (not res.sendFile) so any I/O error still
// results in a 200 response — the Cloud Run healthcheck only checks status code.
app.get("/", (_req: Request, res: Response) => {
  const indexPath = path.resolve("artifacts/ai-studio/dist/public/index.html");
  try {
    if (!existsSync(indexPath)) {
      res.setHeader("Content-Type", "application/json");
      res.status(200).end('{"status":"ok"}');
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200);
    const stream = createReadStream(indexPath);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.setHeader("Content-Type", "application/json");
        res.status(200).end('{"status":"ok"}');
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json");
      res.status(200).end('{"status":"ok"}');
    }
  }
});

// Subdomain & custom-domain routing — must run before the API router so
// requests to <slug>.brand.tld or verified custom domains rewrite to
// /api/projects/:id/preview internally.
app.use(deploymentHost());

app.use("/api", router);

// 404 JSON handler for unmatched /api/* routes (must come before static middleware)
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// In production, serve the built AI Studio frontend so the Express server
// handles everything on a single port.
const staticDir = path.resolve("artifacts/ai-studio/dist/public");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir, { index: false }));

  // SPA fallback: return index.html for every non-API, non-root route so
  // React Router can handle client-side navigation.
  app.get(/^(?!\/(api|$))/, (_req: Request, res: Response, next: NextFunction) => {
    const indexPath = path.join(staticDir, "index.html");
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
}

// Global Express error handler — MUST be last, 4-argument signature required.
// Logs the error and returns 500 JSON. Without this, Express uses its default
// handler which returns HTML — this makes errors visible in production logs.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[express-error]", err?.name, err?.message);
  if (err?.stack) console.error(err.stack.split("\n").slice(0, 3).join("\n"));
  if (!res.headersSent) {
    res.status(500).json({ error: "internal", message: err?.message ?? "Unknown error" });
  }
});

export default app;
