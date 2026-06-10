import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { existsSync, readFileSync } from "fs";
import path from "path";
import router from "./routes";
import { trafficLogger } from "./lib/traffic-log.js";
import { deploymentHost } from "./middleware/deployment-host.js";

// Resolve the built frontend directory.
// Dev (tsx):  process.cwd() = .../artifacts/api-server   → go up one to artifacts/
// Prod (CJS): process.cwd() = workspace root              → go into artifacts/
// esbuild hard-codes NODE_ENV="production" in the bundle so this branch is
// resolved at build time and the correct literal path is inlined.
const staticDir = process.env.NODE_ENV === "production"
  ? path.resolve(process.cwd(), "artifacts/ai-studio/dist/public")
  : path.resolve(process.cwd(), "../ai-studio/dist/public");

const app: Express = express();

// ── Diagnostic request logger ──────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[req] ${req.method} ${req.url} host=${req.headers.host ?? "-"}`);
  next();
});

// ── Root / health route ────────────────────────────────────────────────────
// Registered FIRST — before cors, trafficLogger, or anything that patches res.
// Uses raw Node.js writeHead/end so no abstraction layer can change the status.
app.get("/", (_req: Request, res: Response) => {
  const indexPath = path.join(staticDir, "index.html");
  const exists = existsSync(indexPath);
  console.log(`[GET /] staticDir=${staticDir} indexExists=${exists}`);
  try {
    if (exists) {
      const html = readFileSync(indexPath, "utf-8");
      (res as any).writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      (res as any).end(html);
    } else {
      (res as any).writeHead(200, { "Content-Type": "application/json" });
      (res as any).end('{"status":"ok"}');
    }
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

// Serve the built AI Studio frontend and handle client-side SPA routing.
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
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[express-error]", err?.name, err?.message);
  if (err?.stack) console.error(err.stack.split("\n").slice(0, 3).join("\n"));
  if (!res.headersSent) {
    res.status(500).json({ error: "internal", message: err?.message ?? "Unknown error" });
  }
});

export default app;
