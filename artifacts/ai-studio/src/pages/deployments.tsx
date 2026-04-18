import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/context/AuthContext";
import { getToken } from "@/lib/auth";
import {
  Globe,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  X,
  Loader2,
} from "lucide-react";

interface CustomDomain {
  id: string;
  domain: string;
  status: string;
  verificationTarget: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

interface Deployment {
  id: string;
  projectId: string;
  userId: string;
  slug: string;
  brandedUrl: string;
  provider: string;
  status: string;
  errorMessage: string | null;
  buildLogs: string[];
  lastDeployedAt: string;
  createdAt: string;
  customDomains: CustomDomain[];
}

interface Project {
  id: string;
  name: string;
  type: string;
  status: string;
  hasCode: boolean;
}

export default function DeploymentsPage() {
  const { user } = useAuth();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [activeDeployment, setActiveDeployment] = useState<Deployment | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [domainBusy, setDomainBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const t = getToken();
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [depRes, projRes] = await Promise.all([
        fetch("/api/deployments", { headers: headers() }),
        fetch("/api/projects", { headers: headers() }),
      ]);
      if (!depRes.ok) throw new Error(`Could not load deployments (${depRes.status})`);
      if (!projRes.ok) throw new Error(`Could not load projects (${projRes.status})`);
      const dep = (await depRes.json()) as Deployment[];
      const prj = (await projRes.json()) as Project[];
      setDeployments(dep);
      setProjects(prj);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const deployable = projects.filter((p) => p.hasCode && !deployments.some((d) => d.projectId === p.id));

  async function handleCreate() {
    if (!selectedProjectId) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, string> = { projectId: selectedProjectId };
      if (customSlug.trim()) body.slug = customSlug.trim().toLowerCase();
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Deploy failed (${res.status})`);
      setShowNew(false);
      setSelectedProjectId("");
      setCustomSlug("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this deployment? The branded URL and any custom domains will stop working.")) return;
    try {
      const res = await fetch(`/api/deployments/${id}`, { method: "DELETE", headers: headers() });
      if (!res.ok && res.status !== 204) throw new Error(`Delete failed (${res.status})`);
      if (activeDeployment?.id === id) setActiveDeployment(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAddDomain() {
    if (!activeDeployment || !domainInput.trim()) return;
    setDomainBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deployments/${activeDeployment.id}/domains`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ domain: domainInput.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Failed to add domain (${res.status})`);
      setDomainInput("");
      await load();
      // Re-fetch single deployment so its domain list updates
      const fresh = await fetch(`/api/deployments/${activeDeployment.id}`, { headers: headers() });
      if (fresh.ok) setActiveDeployment(await fresh.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDomainBusy(false);
    }
  }

  async function handleVerify(domainId: string) {
    if (!activeDeployment) return;
    try {
      const res = await fetch(`/api/deployments/${activeDeployment.id}/domains/${domainId}/verify`, {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Verify failed (${res.status})`);
      await load();
      const fresh = await fetch(`/api/deployments/${activeDeployment.id}`, { headers: headers() });
      if (fresh.ok) setActiveDeployment(await fresh.json());
      if (data.detail) alert(data.detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemoveDomain(domainId: string) {
    if (!activeDeployment) return;
    if (!confirm("Remove this custom domain?")) return;
    try {
      await fetch(`/api/deployments/${activeDeployment.id}/domains/${domainId}`, {
        method: "DELETE",
        headers: headers(),
      });
      await load();
      const fresh = await fetch(`/api/deployments/${activeDeployment.id}`, { headers: headers() });
      if (fresh.ok) setActiveDeployment(await fresh.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-primary flex items-center gap-3">
              <Globe className="w-8 h-8" /> Deployments
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Push your projects to a live URL. Branded subdomain comes free; add a custom domain on Starter or higher.
            </p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            disabled={deployable.length === 0}
            className="px-4 py-2 bg-primary text-background font-mono font-semibold rounded hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New Deployment
          </button>
        </div>

        {error && (
          <div className="border border-red-500/40 bg-red-500/10 text-red-300 rounded p-3 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        <div className="border border-cyan-500/30 bg-cyan-500/5 rounded p-4 text-sm text-cyan-100/80">
          <p className="font-semibold text-cyan-300 mb-1">How it works</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Pick a project (must be built) → we assign <code className="text-cyan-300">your-project.nexuseliteaistudio.nexus</code>.</li>
            <li>Visit the URL — it serves your project live, instantly. Re-deploys are also instant.</li>
            <li>For your own domain (e.g. <code className="text-cyan-300">myapp.com</code>), add it below and create a CNAME record at your DNS host.</li>
          </ol>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : deployments.length === 0 ? (
          <div className="border border-border rounded-lg p-12 text-center text-muted-foreground">
            <Globe className="w-12 h-12 mx-auto mb-4 opacity-40" />
            <p className="text-lg font-mono">No deployments yet</p>
            <p className="text-sm mt-2">
              {deployable.length > 0
                ? "Click New Deployment to push a project live."
                : "Build a project first, then come back to deploy it."}
            </p>
            {deployable.length === 0 && (
              <Link href="/projects/new" className="inline-block mt-4 text-primary underline">
                Start a new project →
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {deployments.map((d) => {
              const project = projects.find((p) => p.id === d.projectId);
              const verifiedDomains = d.customDomains.filter((cd) => cd.status === "verified");
              return (
                <div key={d.id} className="border border-border rounded-lg p-4 bg-card hover:border-primary/50 transition">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={
                          d.status === "live"
                            ? "px-2 py-0.5 text-xs rounded bg-green-500/20 text-green-300 border border-green-500/40"
                            : d.status === "failed"
                            ? "px-2 py-0.5 text-xs rounded bg-red-500/20 text-red-300 border border-red-500/40"
                            : "px-2 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/40"
                        }>
                          {d.status.toUpperCase()}
                        </span>
                        <span className="text-foreground font-semibold truncate">
                          {project?.name || d.projectId}
                        </span>
                      </div>
                      <a
                        href={d.brandedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary text-sm font-mono hover:underline flex items-center gap-1 break-all"
                      >
                        {d.brandedUrl} <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                      {verifiedDomains.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {verifiedDomains.map((cd) => (
                            <a
                              key={cd.id}
                              href={`https://${cd.domain}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-green-300 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded hover:bg-green-500/20"
                            >
                              {cd.domain} ✓
                            </a>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Last deployed {new Date(d.lastDeployedAt).toLocaleString()} · {d.customDomains.length} custom domain{d.customDomains.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => copyText(d.brandedUrl, `url-${d.id}`)}
                        className="px-3 py-1.5 text-xs border border-border rounded hover:bg-muted flex items-center gap-1"
                      >
                        {copied === `url-${d.id}` ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        Copy URL
                      </button>
                      <button
                        onClick={() => setActiveDeployment(d)}
                        className="px-3 py-1.5 text-xs border border-primary/40 text-primary rounded hover:bg-primary/10"
                      >
                        Manage Domains
                      </button>
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="px-3 py-1.5 text-xs border border-red-500/40 text-red-300 rounded hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* New deployment modal */}
        {showNew && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !creating && setShowNew(false)}>
            <div className="bg-card border border-primary/40 rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-primary">Deploy a Project</h2>
                <button onClick={() => setShowNew(false)} disabled={creating}><X className="w-5 h-5" /></button>
              </div>
              <label className="block text-sm font-mono text-muted-foreground mb-1">Project</label>
              <select
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  const p = projects.find((x) => x.id === e.target.value);
                  if (p && !customSlug) setCustomSlug(p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32));
                }}
                className="w-full bg-background border border-border rounded px-3 py-2 text-foreground mb-4"
              >
                <option value="">— Select a project —</option>
                {deployable.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                ))}
              </select>
              <label className="block text-sm font-mono text-muted-foreground mb-1">Branded subdomain (optional)</label>
              <div className="flex items-center bg-background border border-border rounded mb-4">
                <input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="my-app"
                  className="flex-1 bg-transparent px-3 py-2 text-foreground outline-none text-sm font-mono"
                />
                <span className="px-3 text-muted-foreground text-sm">.nexuseliteaistudio.nexus</span>
              </div>
              <button
                onClick={handleCreate}
                disabled={!selectedProjectId || creating}
                className="w-full px-4 py-2 bg-primary text-background font-mono font-semibold rounded hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Deploying…</> : <>Deploy Now</>}
              </button>
            </div>
          </div>
        )}

        {/* Manage domains drawer */}
        {activeDeployment && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setActiveDeployment(null)}>
            <div className="bg-card border border-primary/40 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-primary">Manage Custom Domains</h2>
                  <p className="text-xs text-muted-foreground font-mono">{activeDeployment.brandedUrl}</p>
                </div>
                <button onClick={() => setActiveDeployment(null)}><X className="w-5 h-5" /></button>
              </div>

              <div className="border border-border rounded p-3 mb-4 bg-background/50">
                <p className="text-sm font-mono text-muted-foreground mb-2">Add a domain you own</p>
                <div className="flex gap-2">
                  <input
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="myapp.example.com"
                    className="flex-1 bg-background border border-border rounded px-3 py-2 text-foreground text-sm font-mono outline-none focus:border-primary/60"
                  />
                  <button
                    onClick={handleAddDomain}
                    disabled={!domainInput.trim() || domainBusy}
                    className="px-3 py-2 bg-primary text-background text-sm font-mono rounded hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1"
                  >
                    {domainBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
                  </button>
                </div>
              </div>

              {activeDeployment.customDomains.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No custom domains yet.</p>
              ) : (
                <div className="space-y-3">
                  {activeDeployment.customDomains.map((cd) => (
                    <div key={cd.id} className="border border-border rounded p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="font-mono text-sm text-foreground">{cd.domain}</p>
                          <span className={
                            cd.status === "verified"
                              ? "text-xs text-green-300 inline-flex items-center gap-1"
                              : "text-xs text-yellow-300 inline-flex items-center gap-1"
                          }>
                            {cd.status === "verified" ? <><CheckCircle2 className="w-3 h-3" /> Verified</> : <><AlertCircle className="w-3 h-3" /> Pending verification</>}
                            {cd.lastCheckedAt && <span className="text-muted-foreground"> · checked {new Date(cd.lastCheckedAt).toLocaleString()}</span>}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleVerify(cd.id)}
                            className="px-2 py-1 text-xs border border-cyan-500/40 text-cyan-300 rounded hover:bg-cyan-500/10 flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> Verify
                          </button>
                          <button
                            onClick={() => handleRemoveDomain(cd.id)}
                            className="px-2 py-1 text-xs border border-red-500/40 text-red-300 rounded hover:bg-red-500/10"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {cd.status === "pending" && cd.verificationTarget && (
                        <div className="mt-3 bg-background border border-border rounded p-2 text-xs space-y-1">
                          <p className="text-muted-foreground">At your DNS host, add this CNAME record:</p>
                          <div className="grid grid-cols-3 gap-2 font-mono">
                            <div>
                              <p className="text-muted-foreground text-[10px]">Type</p>
                              <p>CNAME</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-[10px]">Host</p>
                              <p className="break-all">{cd.domain}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-[10px]">Value</p>
                              <p className="break-all flex items-center gap-1">
                                {cd.verificationTarget}
                                <button onClick={() => copyText(cd.verificationTarget!, `target-${cd.id}`)}>
                                  {copied === `target-${cd.id}` ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />}
                                </button>
                              </p>
                            </div>
                          </div>
                          <p className="text-muted-foreground pt-1">DNS can take up to 30 minutes to propagate.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
