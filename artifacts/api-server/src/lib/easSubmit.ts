const EXPO_OWNER = "Nexuselitestudio";
const EAS_API    = "https://api.expo.dev";

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
 * Submit a finished EAS build to the app stores via the EAS REST API.
 * Note: Requires Apple Developer / Google Play credentials configured in Expo.
 */
export async function submitBuild(opts: {
  buildId:  string;
  platform: "android" | "ios";
}): Promise<SubmissionResult> {
  const { buildId, platform } = opts;
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error("EXPO_TOKEN not set");

  const body = {
    appId:    `${EXPO_OWNER}/${buildId}`,
    buildId,
    platform: platform.toUpperCase(),
  };

  const res  = await fetch(`${EAS_API}/v2/submissions`, {
    method:  "POST",
    headers: easHeaders(),
    body:    JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`EAS Submit ${res.status}: ${text.slice(0, 300)}`);

  const data: any = JSON.parse(text);
  const sub        = data?.data ?? data;
  const id         = sub.id ?? sub.submissionId ?? "unknown";

  return {
    submissionId: id,
    status:       sub.status ?? "in-queue",
    platform,
    logsPageUrl:  sub.logsPageUrl ?? `https://expo.dev/accounts/${EXPO_OWNER}/submissions/${id}`,
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
