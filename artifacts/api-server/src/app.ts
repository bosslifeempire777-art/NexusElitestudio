import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { trafficLogger } from "./lib/traffic-log.js";
import { deploymentHost } from "./middleware/deployment-host.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

// ── Diagnostic request logger ──────────────────────────────────────────────
// Logs every inbound request before any middleware touches it.
// This helps confirm whether the healthcheck probe even reaches Express.
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[req] ${req.method} ${req.url} host=${req.headers.host ?? "-"}`);
  next();
});

// ── Root / health route ────────────────────────────────────────────────────
// Registered FIRST — before cors, trafficLogger, or anything that patches res.
// Uses raw Node.js writeHead/end (not Express helpers) so no abstraction layer
// can intercept or change the status code.
app.get("/", (_req: Request, res: Response) => {
  console.log("[GET /] handler called");
  const indexPath = path.resolve(__dirname, "../../ai-studio/dist/public/index.html");
  const exists = existsSync(indexPath);
  console.log(`[GET /] indexPath=${indexPath} exists=${exists}`);
  try {
    if (exists) {
      const html = readFileSync(indexPath, "utf-8");
      (res as any).writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      (res as any).end(html);
    } else {
      (res as any).writeHead(200, { "Content-Type": "application/json" });
      (res as any).end('{"status":"ok"}');
    }
    console.log("[GET /] response sent");
  } catch (e: any) {
    console.error("[GET /] error:", e?.message);
    if (!(res as any).headersSent) {
      (res as any).writeHead(200, { "Content-Type": "application/json" });
      (res as any).end('{"status":"ok"}');
    }
  }
});

app.use(cors());

// Stripe webhook MUST receive raw body — register before express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Capture every /api/* request into the in-memory traffic ring buffer
// so the admin "Live Traffic" panel can show real activity.
app.use(trafficLogger());

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
const staticDir = path.resolve(__dirname, "../../ai-studio/dist/public");
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
