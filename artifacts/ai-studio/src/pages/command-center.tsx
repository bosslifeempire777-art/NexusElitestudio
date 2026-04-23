import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@/components/ui/cyber-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { getToken } from "@/lib/auth";
import {
  Terminal, Cpu, Bot, Plus, Play, Trash2, Save, Search,
  Loader2, AlertTriangle, ChevronRight, Sparkles, X,
  Activity, RefreshCw, ChevronDown,
} from "lucide-react";

type Tab = "console" | "models" | "agents" | "custom" | "telemetry";

type ModelInfo = {
  id: string; name: string; contextLength: number;
  pricing?: { prompt: string; completion: string };
  description?: string;
};

type RegistryAgent = {
  id: string; name: string; icon: string; category: string;
  description: string; model: string | null;
};

type CustomAgent = {
  id: string; name: string; description: string; icon: string;
  category: string; model: string; systemPrompt: string;
  capabilities: string[]; isActive: boolean; createdAt: string;
};

type ConsoleEntry = {
  command: string; exitCode: string; durationMs: number;
  stdout: string; stderr: string; truncated?: boolean; ts: number;
};

const fetchJson = async (url: string, init?: RequestInit) => {
  const token = getToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
  return body;
};

export default function CommandCenter() {
  const [tab, setTab] = useState<Tab>("console");

  return (
    <AppLayout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Sparkles className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
            <p className="text-xs text-muted-foreground font-mono">
              ADMIN ONLY — direct shell, OpenRouter models, custom agents
            </p>
          </div>
        </div>

        <div className="flex gap-1 border-b border-border/40">
          {([
            { id: "console", label: "Console",        icon: Terminal },
            { id: "models",  label: "Models",         icon: Cpu      },
            { id: "agents",  label: "Built-in Agents", icon: Bot      },
            { id: "custom",  label: "My Agents",      icon: Plus     },
            { id: "telemetry", label: "Telemetry",    icon: Activity },
          ] as Array<{ id: Tab; label: string; icon: any }>).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 flex items-center gap-2 text-sm font-mono border-b-2 transition-colors ${
                tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {tab === "console" && <ConsoleTab />}
        {tab === "models"  && <ModelsTab  />}
        {tab === "agents"  && <BuiltinAgentsTab />}
        {tab === "custom"  && <CustomAgentsTab    />}
        {tab === "telemetry" && <TelemetryTab />}
      </div>
    </AppLayout>
  );
}

/* ─────────────────────── CONSOLE ─────────────────────── */
function ConsoleTab() {
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory]  = useState<ConsoleEntry[]>([]);
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => { outRef.current?.scrollTo(0, outRef.current.scrollHeight); }, [history]);

  const run = async () => {
    const cmd = command.trim();
    if (!cmd || running) return;
    setRunning(true);
    try {
      const r = await fetchJson("/api/command-center/exec", {
        method: "POST",
        body: JSON.stringify({ command: cmd }),
      });
      setHistory(h => [...h, { ...r, ts: Date.now() }]);
      setCommand("");
    } catch (e: any) {
      setHistory(h => [...h, {
        command: cmd, exitCode: "error", durationMs: 0,
        stdout: "", stderr: e.message, ts: Date.now(),
      }]);
    } finally {
      setRunning(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm">Workspace shell</CardTitle>
          <Badge variant="outline" className="ml-auto text-[10px]">cwd: /home/runner/workspace</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/30 rounded p-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Commands run as the deploy user inside your project directory with full access.
              Use responsibly — destructive system commands are blocked but app changes are not.
              Press <kbd className="px-1 bg-secondary rounded">Ctrl/⌘ + Enter</kbd> to run.
            </span>
          </div>

          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKey}
            placeholder='e.g.  npx skills add OpenRouterTeam/agent-skills --yes'
            rows={3}
            className="w-full bg-black/60 border border-border rounded p-3 font-mono text-sm text-primary placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary"
          />
          <div className="flex justify-end">
            <Button onClick={run} disabled={running || !command.trim()}>
              {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              {running ? "Running…" : "Run"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Output</CardTitle></CardHeader>
        <CardContent>
          <div ref={outRef} className="h-[420px] overflow-y-auto bg-black/80 border border-border rounded p-3 font-mono text-xs space-y-3">
            {history.length === 0 && (
              <div className="text-muted-foreground/40 italic">No commands run yet.</div>
            )}
            {history.map((h, i) => (
              <div key={i} className="space-y-1 border-b border-border/30 pb-2">
                <div className="flex items-center gap-2 text-primary">
                  <ChevronRight className="w-3 h-3" />
                  <span className="font-bold">{h.command}</span>
                  <span className={`ml-auto ${h.exitCode === "0" ? "text-green-400" : "text-red-400"}`}>
                    exit {h.exitCode} · {h.durationMs}ms
                  </span>
                </div>
                {h.stdout && <pre className="whitespace-pre-wrap text-foreground/80">{h.stdout}</pre>}
                {h.stderr && <pre className="whitespace-pre-wrap text-red-400/80">{h.stderr}</pre>}
                {h.truncated && <div className="text-amber-400 italic">[output truncated]</div>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────── MODELS ─────────────────────── */
function ModelsTab() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetchJson("/api/command-center/openrouter/models")
      .then(r => setModels(r.data || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    if (!term) return models.slice(0, 200);
    return models.filter(m =>
      m.id.toLowerCase().includes(term) ||
      m.name?.toLowerCase().includes(term) ||
      m.description?.toLowerCase().includes(term)
    ).slice(0, 200);
  }, [models, q]);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm">OpenRouter model catalogue</CardTitle>
          <Badge variant="outline" className="ml-auto text-[10px]">{models.length} models</Badge>
        </CardHeader>
        <CardContent>
          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by id, name, description…"
              className="w-full bg-black/60 border border-border rounded pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {loading && <div className="text-center text-muted-foreground py-8"><Loader2 className="w-5 h-5 inline animate-spin mr-2" />Loading models…</div>}
          {err && <div className="text-red-400 text-sm">{err}</div>}

          <div className="grid gap-2 max-h-[520px] overflow-y-auto">
            {filtered.map(m => (
              <div key={m.id} className="border border-border/40 rounded p-3 hover:border-primary/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-primary truncate">{m.id}</div>
                    <div className="text-xs text-muted-foreground truncate">{m.name}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                    {m.contextLength?.toLocaleString()} ctx
                  </div>
                </div>
                {m.pricing && (
                  <div className="text-[10px] text-muted-foreground/60 font-mono mt-1">
                    in: ${m.pricing.prompt} · out: ${m.pricing.completion}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────── BUILT-IN AGENTS ───────────────── */
function BuiltinAgentsTab() {
  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const reload = async () => {
    const [a, m] = await Promise.all([
      fetchJson("/api/command-center/agent-assignments"),
      fetchJson("/api/command-center/openrouter/models"),
    ]);
    setAgents(a.agents || []);
    setModels(m.data || []);
  };
  useEffect(() => { reload().catch(console.error); }, []);

  const assign = async (agentId: string, model: string) => {
    setSaving(agentId);
    try {
      if (!model) {
        await fetchJson(`/api/command-center/agent-assignments/${agentId}`, { method: "DELETE" });
        setAgents(prev => prev.map(a => a.id === agentId ? { ...a, model: null } : a));
      } else {
        await fetchJson("/api/command-center/agent-assignments", {
          method: "POST",
          body: JSON.stringify({ agentId, model }),
        });
        setAgents(prev => prev.map(a => a.id === agentId ? { ...a, model } : a));
      }
    } finally { setSaving(null); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Bot className="w-4 h-4 text-primary" />
        <CardTitle className="text-sm">Plug models into your 21 agents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {agents.map(a => (
          <div key={a.id} className="flex items-center gap-3 border border-border/40 rounded p-3">
            <div className="text-2xl">{a.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{a.name}</div>
              <div className="text-xs text-muted-foreground truncate">{a.description}</div>
            </div>
            <select
              value={a.model ?? ""}
              onChange={(e) => assign(a.id, e.target.value)}
              className="bg-black/60 border border-border rounded px-2 py-1 text-xs font-mono min-w-[260px]"
              disabled={saving === a.id || models.length === 0}
            >
              <option value="">— default —</option>
              {models.slice(0, 200).map(m => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
            {saving === a.id && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          </div>
        ))}
        {agents.length === 0 && <div className="text-muted-foreground text-sm py-4">Loading agents…</div>}
      </CardContent>
    </Card>
  );
}

/* ─────────────────── CUSTOM AGENTS ─────────────────── */
function CustomAgentsTab() {
  const [list, setList] = useState<CustomAgent[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [editing, setEditing] = useState<Partial<CustomAgent> | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [output, setOutput] = useState<string>("");

  const reload = async () => {
    const [a, m] = await Promise.all([
      fetchJson("/api/command-center/custom-agents"),
      fetchJson("/api/command-center/openrouter/models"),
    ]);
    setList(a.agents || []);
    setModels(m.data || []);
  };
  useEffect(() => { reload().catch(console.error); }, []);

  const save = async () => {
    if (!editing?.name || !editing.model || !editing.systemPrompt) return;
    if (editing.id) {
      await fetchJson(`/api/command-center/custom-agents/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify(editing),
      });
    } else {
      await fetchJson("/api/command-center/custom-agents", {
        method: "POST",
        body: JSON.stringify(editing),
      });
    }
    setEditing(null);
    reload();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this agent?")) return;
    await fetchJson(`/api/command-center/custom-agents/${id}`, { method: "DELETE" });
    reload();
  };

  const run = async (id: string) => {
    if (!task.trim()) return;
    setRunning(id);
    setOutput("");
    try {
      const r = await fetchJson(`/api/command-center/custom-agents/${id}/run`, {
        method: "POST",
        body: JSON.stringify({ task }),
      });
      setOutput(r.output || "(no output)");
    } catch (e: any) {
      setOutput("Error: " + e.message);
    } finally { setRunning(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ icon: "🤖", category: "custom", capabilities: [], isActive: true })}>
          <Plus className="w-4 h-4 mr-2" /> New custom agent
        </Button>
      </div>

      {editing && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CardTitle className="text-sm">{editing.id ? "Edit agent" : "Create agent"}</CardTitle>
            <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setEditing(null)}>
              <X className="w-4 h-4" />
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input value={editing.name ?? ""} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Agent name *" className="bg-black/60 border border-border rounded px-3 py-2 text-sm md:col-span-2" />
              <input value={editing.icon ?? "🤖"} onChange={e => setEditing({ ...editing, icon: e.target.value })}
                placeholder="🤖" maxLength={4} className="bg-black/60 border border-border rounded px-3 py-2 text-sm text-center" />
            </div>
            <input value={editing.description ?? ""} onChange={e => setEditing({ ...editing, description: e.target.value })}
              placeholder="Short description" className="w-full bg-black/60 border border-border rounded px-3 py-2 text-sm" />
            <select value={editing.model ?? ""} onChange={e => setEditing({ ...editing, model: e.target.value })}
              className="w-full bg-black/60 border border-border rounded px-3 py-2 text-sm font-mono">
              <option value="">— select OpenRouter model * —</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
            <textarea value={editing.systemPrompt ?? ""} onChange={e => setEditing({ ...editing, systemPrompt: e.target.value })}
              placeholder="System prompt — define this agent's role, tone, and rules *"
              rows={6} className="w-full bg-black/60 border border-border rounded px-3 py-2 text-sm font-mono" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} disabled={!editing.name || !editing.model || !editing.systemPrompt}>
                <Save className="w-4 h-4 mr-2" /> {editing.id ? "Save" : "Create"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {list.length === 0 && !editing && (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
          No custom agents yet. Click "New custom agent" to build your first.
        </CardContent></Card>
      )}

      {list.map(a => (
        <Card key={a.id}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="text-3xl">{a.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{a.name}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{a.model}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{a.description}</div>
              </div>
              <Button variant="outline" onClick={() => setEditing(a)}><Save className="w-3 h-3" /></Button>
              <Button variant="outline" onClick={() => remove(a.id)}><Trash2 className="w-3 h-3 text-red-400" /></Button>
            </div>

            <div className="mt-3 flex gap-2">
              <input value={task} onChange={e => setTask(e.target.value)}
                placeholder="Send a task to this agent…"
                className="flex-1 bg-black/60 border border-border rounded px-3 py-2 text-sm" />
              <Button onClick={() => run(a.id)} disabled={running === a.id || !task.trim()}>
                {running === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              </Button>
            </div>
            {running === a.id && <div className="text-xs text-muted-foreground mt-2">Running…</div>}
            {output && running !== a.id && (
              <pre className="mt-3 bg-black/80 border border-border rounded p-3 text-xs whitespace-pre-wrap max-h-[260px] overflow-y-auto">{output}</pre>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─────────────────────── TELEMETRY ─────────────────────── */
type TelemetryRun = {
  id: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  operation: string | null;
  model: string | null;
  provider: string | null;
  status: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  messages: Array<{ role: string; content: string }>;
  responseContent: string | null;
  error: any;
};

type TelemetryStats = {
  totalRuns: number;
  success: number;
  errors: number;
  totalTokens: number;
};

function TelemetryTab() {
  const [runs, setRuns] = useState<TelemetryRun[]>([]);
  const [stats, setStats] = useState<TelemetryStats>({ totalRuns: 0, success: 0, errors: 0, totalTokens: 0 });
  const [filePath, setFilePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchJson("/api/command-center/telemetry");
      setRuns(r.runs || []);
      setStats(r.stats || { totalRuns: 0, success: 0, errors: 0, totalTokens: 0 });
      setFilePath(r.path || "");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [autoRefresh]);

  const clearAll = async () => {
    if (!confirm("Clear all captured telemetry? This wipes the local capture file.")) return;
    await fetchJson("/api/command-center/telemetry", { method: "DELETE" });
    await load();
  };

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm">OpenRouter Telemetry</CardTitle>
          <Badge variant="outline" className="ml-auto text-[10px] font-mono truncate max-w-[40ch]">
            {filePath || "loading…"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label="Total runs"   value={stats.totalRuns} />
            <Stat label="Successful"   value={stats.success} tone="text-green-400" />
            <Stat label="Errors"       value={stats.errors} tone="text-red-400" />
            <Stat label="Total tokens" value={stats.totalTokens.toLocaleString()} tone="text-primary" />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={load} disabled={loading} variant="outline" className="text-xs">
              {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Refresh
            </Button>
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-primary"
              />
              Auto-refresh (4s)
            </label>
            <Button onClick={clearAll} variant="outline" className="ml-auto text-xs text-red-400 hover:text-red-300">
              <Trash2 className="w-3 h-3 mr-1" /> Clear
            </Button>
          </div>
          {err && (
            <div className="text-xs text-red-400 bg-red-400/5 border border-red-400/30 rounded p-2">
              {err}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent runs (newest first, last 200)</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground/60 italic py-6 text-center">
              No captured runs yet. Run any custom agent to start capturing.
            </div>
          )}
          <div className="space-y-1">
            {runs.map(r => {
              const isOpen = expanded.has(r.id);
              const ok = r.status === "success";
              return (
                <div key={r.id} className="border border-border/40 rounded bg-black/40">
                  <button
                    onClick={() => toggle(r.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-secondary/30 transition-colors"
                  >
                    <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                    <span className={ok ? "text-green-400" : "text-red-400"}>
                      {ok ? "●" : "✕"}
                    </span>
                    <span className="text-foreground/80 truncate max-w-[28ch]">{r.model || "—"}</span>
                    {r.provider && <span className="text-muted-foreground/60">via {r.provider}</span>}
                    <span className="text-muted-foreground ml-auto">
                      {r.totalTokens != null ? `${r.totalTokens} tok` : "—"}
                    </span>
                    <span className="text-muted-foreground/60">
                      {r.durationMs != null ? `${r.durationMs}ms` : ""}
                    </span>
                    <span className="text-muted-foreground/40 hidden md:inline">
                      {r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : ""}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30 text-xs">
                      <Meta label="Run ID"        value={r.id} />
                      <Meta label="Started"       value={r.startedAt ? new Date(r.startedAt).toISOString() : "—"} />
                      <Meta label="Operation"     value={r.operation || "—"} />
                      <Meta label="Finish reason" value={r.finishReason || "—"} />
                      <Meta label="Tokens" value={
                        r.totalTokens != null
                          ? `${r.promptTokens} prompt + ${r.completionTokens} completion = ${r.totalTokens} total`
                          : "—"
                      } />

                      <div>
                        <div className="text-muted-foreground mb-1">Messages</div>
                        <div className="space-y-1">
                          {r.messages.map((m, i) => (
                            <div key={i} className="bg-black/60 border border-border/40 rounded p-2">
                              <div className="text-[10px] uppercase text-primary mb-1">{m.role}</div>
                              <pre className="whitespace-pre-wrap font-mono text-foreground/80">{m.content}</pre>
                            </div>
                          ))}
                        </div>
                      </div>

                      {r.responseContent != null && (
                        <div>
                          <div className="text-muted-foreground mb-1">Response</div>
                          <pre className="bg-black/60 border border-border/40 rounded p-2 whitespace-pre-wrap font-mono text-green-300/90">
                            {r.responseContent}
                          </pre>
                        </div>
                      )}

                      {r.error && (
                        <div>
                          <div className="text-muted-foreground mb-1">Error</div>
                          <pre className="bg-red-500/5 border border-red-500/30 rounded p-2 whitespace-pre-wrap font-mono text-red-400">
                            {typeof r.error === "string" ? r.error : JSON.stringify(r.error, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="bg-black/40 border border-border/40 rounded p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-lg font-mono ${tone || "text-foreground"}`}>{value}</div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <span className="font-mono text-foreground/80 break-all">{value}</span>
    </div>
  );
}
