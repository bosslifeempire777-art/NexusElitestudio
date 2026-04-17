/**
 * In-memory ring buffer of recent HTTP requests, used by the admin
 * "Live Traffic" panel. Holds the last N entries; oldest entries are
 * evicted as new ones come in.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken } from "../middleware/auth.js";

export interface TrafficEntry {
  id: number;
  ts: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string;
  userId: string | null;
  username: string | null;
  isAdmin: boolean;
  userAgent: string;
  bytesOut: number;
}

const MAX_ENTRIES = 500;
const buffer: TrafficEntry[] = [];
let counter = 0;

/** Returns the most recent traffic entries, newest first. */
export function getRecentTraffic(limit = 100): TrafficEntry[] {
  return buffer.slice(-Math.min(limit, MAX_ENTRIES)).reverse();
}

/** Returns aggregated stats over the buffered window. */
export function getTrafficSummary() {
  const now = Date.now();
  const last5min = buffer.filter((e) => now - e.ts < 5 * 60_000);
  const last1hr = buffer.filter((e) => now - e.ts < 60 * 60_000);
  const errors = buffer.filter((e) => e.status >= 500);
  const uniqueIps = new Set(buffer.map((e) => e.ip)).size;
  const uniqueUsers = new Set(buffer.filter((e) => e.userId).map((e) => e.userId!)).size;

  // Per-path counts (top 10)
  const pathCounts: Record<string, number> = {};
  for (const e of buffer) {
    // collapse :id-style segments
    const norm = e.path.replace(/\/[A-Za-z0-9_-]{8,}/g, "/:id");
    pathCounts[norm] = (pathCounts[norm] || 0) + 1;
  }
  const topPaths = Object.entries(pathCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  return {
    bufferSize: buffer.length,
    capacity: MAX_ENTRIES,
    requestsLast5Min: last5min.length,
    requestsLastHour: last1hr.length,
    errorCount: errors.length,
    uniqueIps,
    uniqueUsers,
    topPaths,
  };
}

/** Express middleware: append a request entry once the response finishes. */
export function trafficLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Best-effort identity decode from bearer token (no error on bad tokens).
    let userId: string | null = null;
    let username: string | null = null;
    let isAdmin = false;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      const payload = verifyToken(auth.slice(7));
      if (payload) {
        userId = payload.userId;
        username = payload.username ?? null;
        isAdmin = !!payload.isAdmin;
      }
    }

    let bytesOut = 0;
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = ((chunk: any, ...args: any[]) => {
      if (chunk) bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      return origWrite(chunk, ...args);
    }) as any;
    res.end = ((chunk: any, ...args: any[]) => {
      if (chunk) bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      return origEnd(chunk, ...args);
    }) as any;

    res.on("finish", () => {
      // Only log /api/* to keep the buffer focused; skip the noisy traffic feed itself.
      if (!req.originalUrl.startsWith("/api/")) return;
      if (req.originalUrl.startsWith("/api/admin/traffic")) return;

      const entry: TrafficEntry = {
        id: ++counter,
        ts: Date.now(),
        method: req.method,
        // Strip query string for the path (so secret tokens never end up in logs).
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Date.now() - start,
        ip: (req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()) || req.socket.remoteAddress || "—",
        userId,
        username,
        isAdmin,
        userAgent: (req.headers["user-agent"] || "").toString().slice(0, 200),
        bytesOut,
      };
      buffer.push(entry);
      if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
    });

    next();
  };
}
