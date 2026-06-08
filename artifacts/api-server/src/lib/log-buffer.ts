/**
 * In-process log capture ring buffer.
 * Import once at process startup (side-effect) to intercept console methods
 * and make them available to the admin /logs endpoint.
 */

export interface LogEntry {
  ts:    string;
  level: "log" | "info" | "warn" | "error";
  msg:   string;
}

const BUFFER: LogEntry[] = [];
const MAX = 800;

export function appendLog(level: LogEntry["level"], msg: string): void {
  BUFFER.push({ ts: new Date().toISOString(), level, msg });
  if (BUFFER.length > MAX) BUFFER.splice(0, BUFFER.length - MAX);
}

export function getRecentLogs(n = 200, level?: LogEntry["level"]): LogEntry[] {
  const src = level ? BUFFER.filter(e => e.level === level) : BUFFER;
  return src.slice(-n);
}

export function getLogStats(): { total: number; errors: number; warns: number } {
  return {
    total:  BUFFER.length,
    errors: BUFFER.filter(e => e.level === "error").length,
    warns:  BUFFER.filter(e => e.level === "warn").length,
  };
}

function stringify(...args: unknown[]): string {
  return args.map(a => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ");
}

type ConsoleFn = (...args: unknown[]) => void;

function wrap(orig: ConsoleFn, level: LogEntry["level"]): ConsoleFn {
  return (...args) => {
    orig.apply(console, args);
    appendLog(level, stringify(...args));
  };
}

if (!(console as any).__nexusPatched) {
  (console as any).__nexusPatched = true;
  console.log   = wrap(console.log.bind(console),   "log")   as typeof console.log;
  console.info  = wrap(console.info.bind(console),  "info")  as typeof console.info;
  console.warn  = wrap(console.warn.bind(console),  "warn")  as typeof console.warn;
  console.error = wrap(console.error.bind(console), "error") as typeof console.error;
}
