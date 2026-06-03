import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);
const EXPO_OWNER = "Nexuselitestudio";
const EAS_API    = "https://api.expo.dev";
const EAS_BIN    = resolve(process.cwd(), "artifacts/api-server/node_modules/.bin/eas");

function easHeaders(): Record<string, string> {
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error("EXPO_TOKEN not set");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export interface SubmissionResult {
  submissionId: string;
  status:       string;
  platform:     string;
  logsPageUrl:  string | null;
}

export interface SubmissionStatus {
  submissionId: string;
  status:       string;
  platform:     string;
  logsPageUrl:  string | null;
  errorMessage: string | null;
}

/**
 * Submit a finished EAS build to the app stores via EAS CLI.
 * Uses `eas submit --id <buildId> --platform <platform>`.
 * Requires Apple Developer / Google Play credentials in your Expo account.
 */
export async function submitBuild(opts: {
  buildId:  string;
  platform: "android" | "ios";
}): Promise<SubmissionResult> {
  const { buildId, platform } = opts;
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error("EXPO_TOKEN not set");

  const { stdout } = await execFileAsync(
    EAS_BIN,
    ["submit", "--id", buildId, "--platform", platform, "--non-interactive", "--no-wait", "--json"],
    {
      timeout: 120_000,
      env: { ...process.env, EXPO_TOKEN: token, CI: "1", EXPO_NO_TELEMETRY: "1" },
    },
  );

  let parsed: any = {};
  try { parsed = JSON.parse(stdout.trim()); } catch { /* ignore */ }
  const sub = Array.isArray(parsed) ? parsed[0] : parsed;
  const id  = sub?.id ?? sub?.submissionId ?? buildId;

  return {
    submissionId: id,
    status:       sub?.status ?? "in-queue",
    platform,
    logsPageUrl:  sub?.logsPageUrl ?? `https://expo.dev/accounts/${EXPO_OWNER}/submissions/${id}`,
  };
}

/** Poll EAS submission status */
export async function getSubmissionStatus(submissionId: string): Promise<SubmissionStatus> {
  const res  = await fetch(`${EAS_API}/v2/submissions/${submissionId}`, {
    headers: easHeaders(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`EAS SubmissionStatus ${res.status}: ${text.slice(0, 300)}`);

  const data: any = JSON.parse(text);
  const sub        = data?.data ?? data;

  return {
    submissionId,
    status:       sub.status ?? "unknown",
    platform:     (sub.platform ?? "").toLowerCase(),
    logsPageUrl:  sub.logsPageUrl ?? null,
    errorMessage: sub.error?.message ?? null,
  };
}
