import { createGzip } from "zlib";

const RAILWAY_GQL = "https://backboard.railway.app/graphql/v2";

export function isRailwayConfigured(): boolean {
  return !!process.env["RAILWAY_TOKEN"];
}

function getToken(): string {
  const t = process.env["RAILWAY_TOKEN"];
  if (!t) throw new Error("RAILWAY_TOKEN is not configured");
  return t;
}

async function gql<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RAILWAY_GQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Railway API ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  return body.data as T;
}

export async function pingRailway(): Promise<{ ok: boolean; email?: string; error?: string }> {
  try {
    const data = await gql<{ me: { email: string } }>(
      `query { me { email name } }`,
      {},
    );
    return { ok: true, email: data?.me?.email };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Tar.gz builder ─────────────────────────────────────────────────────────
// Railway's source upload accepts a gzipped tar archive of the project files.
// Node's built-in zlib handles the gzip; tar headers are written manually.

function makeTarHeader(filename: string, size: number): Buffer {
  const hdr = Buffer.alloc(512, 0);
  const enc = (s: string, off: number, len: number) => hdr.write(s.slice(0, len), off, "utf-8");
  enc(filename, 0, 100);
  enc("0000755", 100, 8);
  enc("0001750", 108, 8);
  enc("0001750", 116, 8);
  enc(size.toString(8).padStart(11, "0") + " ", 124, 12);
  enc(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + " ", 136, 12);
  enc("        ", 148, 8);
  hdr[156] = 0x30; // type: regular file
  enc("ustar  ", 257, 8);
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += hdr[i]!;
  enc(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return hdr;
}

function buildTarGz(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gz = createGzip();
    const chunks: Buffer[] = [];
    gz.on("data", (c: Buffer) => chunks.push(c));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
    for (const [path, content] of Object.entries(files)) {
      const data = Buffer.from(content, "utf-8");
      gz.write(makeTarHeader(path, data.length));
      gz.write(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad > 0) gz.write(Buffer.alloc(pad));
    }
    gz.write(Buffer.alloc(1024));
    gz.end();
  });
}

// ── Minimal Express server that serves the injected HTML ───────────────────
function buildServerFiles(html: string, slug: string): Record<string, string> {
  const pkgJson = JSON.stringify(
    {
      name: `nexus-${slug}`.slice(0, 52).replace(/[^a-z0-9-]/g, "-"),
      version: "1.0.0",
      scripts: { start: "node server.js" },
      dependencies: { express: "^4.18.2" },
      engines: { node: ">=18" },
    },
    null,
    2,
  );

  const escaped = html
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

  const serverJs = `const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const HTML = \`${escaped}\`;
app.disable("x-powered-by");
app.get("*", (_req, res) => { res.setHeader("Content-Type","text/html"); res.send(HTML); });
app.listen(PORT, () => console.log("NexusElite app running on port " + PORT));
`;

  const railwayToml = `[deploy]\nstartCommand = "node server.js"\n`;

  return {
    "package.json": pkgJson,
    "server.js": serverJs,
    "railway.toml": railwayToml,
  };
}

// ── Create project + service on Railway ────────────────────────────────────
async function createProject(name: string): Promise<{ projectId: string; environmentId: string }> {
  const data = await gql<{
    projectCreate: {
      id: string;
      environments: { edges: { node: { id: string; name: string } }[] };
    };
  }>(
    `mutation projectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        id
        environments { edges { node { id name } } }
      }
    }`,
    { input: { name } },
  );
  const project = data.projectCreate;
  const environmentId = project.environments.edges[0]?.node?.id ?? "";
  if (!project.id || !environmentId) throw new Error("Railway: failed to get project or environment ID");
  return { projectId: project.id, environmentId };
}

async function createService(projectId: string, name: string): Promise<{ serviceId: string }> {
  const data = await gql<{ serviceCreate: { id: string } }>(
    `mutation serviceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }`,
    { input: { projectId, name } },
  );
  return { serviceId: data.serviceCreate.id };
}

// ── Upload source archive to Railway ──────────────────────────────────────
async function uploadSource(
  projectId: string,
  serviceId: string,
  environmentId: string,
  tarGzBuf: Buffer,
): Promise<{ deploymentId: string }> {
  const token = getToken();
  const url =
    `https://backboard.railway.app/v2/projects/${projectId}/services/${serviceId}/upload` +
    `?environmentId=${encodeURIComponent(environmentId)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/gzip",
      "Content-Length": String(tarGzBuf.length),
    },
    body: tarGzBuf,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Railway upload ${res.status}: ${text.slice(0, 400)}`);
  }
  const body = (await res.json()) as { deploymentId?: string; id?: string };
  const deploymentId = body.deploymentId ?? body.id;
  if (!deploymentId) throw new Error("Railway upload returned no deployment ID");
  return { deploymentId };
}

// ── Public: deploy an HTML app to Railway ─────────────────────────────────
export interface CreateRailwayDeploymentInput {
  slug: string;
  html: string;
}

export interface CreateRailwayDeploymentResult {
  ok: boolean;
  deploymentId?: string;
  projectId?: string;
  serviceId?: string;
  url?: string;
  error?: string;
}

export async function createRailwayDeployment(
  input: CreateRailwayDeploymentInput,
): Promise<CreateRailwayDeploymentResult> {
  try {
    const projectName = `nexus-${input.slug}`
      .slice(0, 52)
      .replace(/[^a-z0-9-]/gi, "-")
      .toLowerCase();

    const { projectId, environmentId } = await createProject(projectName);
    const { serviceId } = await createService(projectId, "web");
    const files = buildServerFiles(input.html, input.slug);
    const tarGz = await buildTarGz(files);
    const { deploymentId } = await uploadSource(projectId, serviceId, environmentId, tarGz);

    return {
      ok: true,
      deploymentId,
      projectId,
      serviceId,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Deployment status ──────────────────────────────────────────────────────
export interface RailwayDeploymentStatus {
  ok: boolean;
  status?: string;
  url?: string;
  error?: string;
}

export async function getRailwayDeploymentStatus(
  deploymentId: string,
): Promise<RailwayDeploymentStatus> {
  try {
    const data = await gql<{
      deployment: { id: string; status: string; url?: string; staticUrl?: string };
    }>(
      `query deployment($id: String!) {
        deployment(id: $id) { id status url staticUrl }
      }`,
      { id: deploymentId },
    );
    const d = data.deployment;
    return {
      ok: true,
      status: d.status,
      url: d.url ?? d.staticUrl,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Delete a Railway project (cleans up all services) ─────────────────────
export async function deleteRailwayProject(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await gql<{ projectDelete: boolean }>(
      `mutation projectDelete($id: String!) { projectDelete(id: $id) }`,
      { id: projectId },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
