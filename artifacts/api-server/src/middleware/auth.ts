import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  userId: string;
  username: string;
  isAdmin: boolean;
  isVip: boolean;
  plan: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("JWT_SECRET environment variable is required in production");
    }
    console.warn("[AUTH] WARNING: JWT_SECRET not set — using dev fallback. Set this before deploying.");
    return "nexuselite-dev-fallback-do-not-use-in-prod";
  }
  return secret;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "30d" });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as AuthPayload;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["authorization"];
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized — please log in" });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.auth = payload;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.auth?.isAdmin) {
      res.status(403).json({ error: "Forbidden — Admin access only" });
      return;
    }
    next();
  });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers["authorization"];
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    req.auth = verifyToken(token) ?? undefined;
  }
  next();
}
