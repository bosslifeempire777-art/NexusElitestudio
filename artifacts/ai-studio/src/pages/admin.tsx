import { AppLayout } from "@/components/layout/AppLayout";
import { useGetAnalyticsOverview, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input, Textarea } from "@/components/ui/cyber-ui";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import {
  Users, Database, DollarSign, Activity, Terminal, Send, Loader2,
  Wrench, AlertTriangle, CheckCircle2, RefreshCw, FileCode2, Cpu,
  ChevronRight, RotateCcw, ShieldAlert, Crown, Search, UserCheck, UserX, Gift,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { getToken } from "@/lib/auth";

type RepairMode = "platform" | "project";

interface TerminalLine {
  id: string;
  type: "user" | "ai" | "system" | "error" | "success" | "file" | "warn";
  text: string;
  timestamp: string;
}

function now() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function nanoid6() {
  return Math.random().toString(36).slice(2, 8);
}

async function patchUser(userId: string, payload: Record<string, any>) {
  const token = getToken();
  const res = await fetch(`/api/users/${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed");
  return res.json();
}

export default function Admin() {
  const { data: analytics } = useGetAnalyticsOverview();
  const { data: users, refetch: refetchUsers } = useListUsers();
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const filtered = (users ?? []).filter((u: any) =>
    u.username?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  async function handlePlanChange(userId: string, plan: string, isVip: boolean) {
    setActionLoading(userId);
    setActionMsg(null);
    try {
      await patchUser(userId, { plan, isVip });
      await refetchUsers();
      setActionMsg({ id: userId, text: isVip ? "VIP granted!" : `Plan set to ${plan}`, ok: true });
    } catch (e: any) {
      setActionMsg({ id: userId, text: e.message, ok: false });
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-glow text-destructive flex items-center gap-3">
            <ShieldAlert className="w-8 h-8" /> OVERSEER TERMINAL
          </h1>
          <p className="text-muted-foreground font-mono mt-1">Platform-wide telemetry, access control, and AI self-repair.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatBox title="Total Users" value={analytics?.totalUsers ?? 0} icon={Users} color="text-primary" />
          <StatBox title="Constructs Built" value={analytics?.totalProjects ?? 0} icon={Database} color="text-accent" />
          <StatBox title="Active Agents" value={analytics?.activeAgents ?? 0} icon={Activity} color="text-green-400" />
          <StatBox title="MRR" value={`$${analytics?.totalRevenue ?? 0}`} icon={DollarSign} color="text-yellow-400" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-mono">BUILD VOLUME (30 DAYS)</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics?.buildsOverTime ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(t) => t.substring(5, 10)} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} itemStyle={{ color: 'hsl(var(--primary))' }} />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-mono">REVENUE BY PLAN</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={Object.entries(analytics?.revenueByPlan ?? {}).map(([name, value]) => ({ name, value }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} cursor={{ fill: 'hsl(var(--secondary))' }} />
                  <Bar dataKey="value" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* User Management */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-muted-foreground text-sm font-mono flex items-center gap-2">
              <Crown className="w-4 h-4 text-yellow-400" /> USER MANAGEMENT &amp; VIP ACCESS
            </CardTitle>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search username or email…"
                className="pl-8 h-7 text-xs"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono text-left">
                <thead className="text-xs text-muted-foreground uppercase border-b border-border/50">
                  <tr>
                    <th className="px-4 py-3">Username</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Projects</th>
                    <th className="px-4 py-3">Builds</th>
                    <th className="px-4 py-3 text-right">Access Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filtered.map((user: any) => {
                    const isLoading = actionLoading === user.id;
                    const msg = actionMsg?.id === user.id ? actionMsg : null;
                    const isVip = user.isVip || user.plan === "vip";
                    return (
                      <tr key={user.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {isVip && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
                            <span className={`font-semibold ${isVip ? "text-yellow-400" : "text-foreground"}`}>{user.username}</span>
                            {user.isAdmin && <Badge variant="outline" className="text-[9px] px-1 py-0 border-destructive/50 text-destructive">ADMIN</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{user.email || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={isVip ? "accent" : user.plan === "elite" ? "primary" : "outline"}
                            className={`text-[10px] uppercase ${isVip ? "border-yellow-400/50 text-yellow-400 bg-yellow-400/10" : ""}`}
                          >
                            {user.plan}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-primary">{user.projectCount ?? 0}</td>
                        <td className="px-4 py-3 text-muted-foreground">{user.buildsThisMonth ?? 0}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {msg && (
                              <span className={`text-[10px] font-mono ${msg.ok ? "text-green-400" : "text-destructive"}`}>
                                {msg.text}
                              </span>
                            )}
                            {isLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            ) : isVip ? (
                              <button
                                onClick={() => handlePlanChange(user.id, "free", false)}
                                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors border border-border/30 rounded px-2 py-1"
                                title="Revoke VIP"
                              >
                                <UserX className="w-3 h-3" /> Revoke VIP
                              </button>
                            ) : (
                              <button
                                onClick={() => handlePlanChange(user.id, "vip", true)}
                                className="flex items-center gap-1 text-[10px] text-yellow-400 hover:text-yellow-300 transition-colors border border-yellow-400/30 rounded px-2 py-1 bg-yellow-400/5 hover:bg-yellow-400/10"
                                title="Grant VIP — free Elite access"
                              >
                                <Crown className="w-3 h-3" /> Grant VIP
                              </button>
                            )}
                            <select
                              className="text-[10px] font-mono bg-secondary border border-border/40 rounded px-1.5 py-1 text-muted-foreground hover:border-primary/40 transition-colors cursor-pointer"
                              value={user.plan}
                              disabled={isLoading}
                              onChange={e => handlePlanChange(user.id, e.target.value, e.target.value === "vip")}
                              title="Change plan"
                            >
                              {["free","starter","pro","elite","vip"].map(p => (
                                <option key={p} value={p}>{p.toUpperCase()}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">
                        No users found{search ? ` matching "${search}"` : ""}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Referral Overview */}
        <AdminReferrals />

        {/* AI Repair Terminal */}
        <RepairTerminal />
      </div>
    </AppLayout>
  );
}

function AdminReferrals() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = getToken();
        const r = await fetch("/api/admin/referrals", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) setData(await r.json());
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-sm font-mono text-muted-foreground flex items-center gap-2">
          <Gift className="w-4 h-4 text-primary" />
          REFERRAL PROGRAM OVERVIEW
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading referral data...
          </div>
        ) : !data ? (
          <p className="text-muted-foreground text-sm">No referral data available.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-secondary/20 border border-border/40 rounded p-4 text-center">
                <div className="text-2xl font-display font-bold text-primary">{data.totalReferrals}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">Total Signups</div>
              </div>
              <div className="bg-secondary/20 border border-border/40 rounded p-4 text-center">
                <div className="text-2xl font-display font-bold text-green-400">{data.totalConverted}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">Paid Conversions</div>
              </div>
              <div className="bg-secondary/20 border border-border/40 rounded p-4 text-center">
                <div className="text-2xl font-display font-bold text-yellow-400">{data.totalCreditsAwarded.toLocaleString()}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">Credits Awarded</div>
              </div>
            </div>
            {data.topReferrers?.length > 0 && (
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">Top Referrers</p>
                <div className="space-y-2">
                  {data.topReferrers.map((r: any, i: number) => (
                    <div key={r.username} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground font-mono w-5">#{i + 1}</span>
                        <span className="font-medium">{r.username}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                        <span>{r.referralCount} signups</span>
                        <span className="text-yellow-400">{r.creditBalance} credits</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: any; color: string }) {
  return (
    <div className="bg-secondary/20 border border-border/50 p-4 cyber-clip relative overflow-hidden group hover:border-primary/30 transition-colors">
      <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Icon className={`w-24 h-24 ${color}`} />
      </div>
      <p className="text-xs font-mono text-muted-foreground mb-1 relative z-10 uppercase tracking-widest">{title}</p>
      <p className={`text-3xl font-display font-bold ${color} relative z-10`}>{value}</p>
    </div>
  );
}

function RepairTerminal() {
  const [mode, setMode] = useState<RepairMode>("platform");
  const [projectId, setProjectId] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: "boot",
      type: "system",
      text: "NEXUS REPAIR CORE v2.0 — AI self-repair system online. Platform code and project apps can be edited via natural language.",
      timestamp: now(),
    },
    {
      id: "boot2",
      type: "system",
      text: 'Select a mode: [Platform Code] to edit the studio\'s own source, or [Project App] to fix a specific generated app. Then type your instruction below.',
      timestamp: now(),
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  function addLine(line: Omit<TerminalLine, "id" | "timestamp">) {
    setLines((prev) => [...prev, { ...line, id: nanoid6(), timestamp: now() }]);
  }

  async function handleSend() {
    const msg = input.trim();
    if (!msg || loading) return;

    if (mode === "project" && !projectId.trim()) {
      addLine({ type: "error", text: "ERROR: Project ID is required for Project App mode. Enter the project ID above." });
      return;
    }

    setInput("");
    addLine({ type: "user", text: `> ${msg}` });
    addLine({ type: "system", text: `[${mode === "platform" ? "Platform Repair" : `Project: ${projectId}`}] Scanning codebase and generating patch…` });
    setLoading(true);

    try {
      const token = getToken();
      const res = await fetch("/api/admin/repair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: msg,
          mode,
          projectId: mode === "project" ? projectId.trim() : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        addLine({ type: "error", text: `ERROR ${res.status}: ${data.error ?? "Unknown error"}` });
        return;
      }

      addLine({ type: "ai", text: data.message });

      if (data.changes?.length) {
        for (const c of data.changes) {
          addLine({ type: "system", text: `  • ${c}` });
        }
      }

      if (data.applied?.length) {
        for (const a of data.applied) {
          addLine({ type: "file", text: `  ✓ ${a}` });
        }
      }

      if (data.errors?.length) {
        for (const e of data.errors) {
          addLine({ type: "error", text: `  ✗ ${e}` });
        }
      }

      if (data.requiresRestart) {
        addLine({ type: "warn", text: "⚠  Platform files changed — restart the API Server workflow for changes to take effect." });
      }

      if (mode === "project" && data.applied?.length) {
        addLine({ type: "success", text: `✓ Project app updated. Navigate to the project and click Refresh in the preview to see changes.` });
      }

      if (!data.applied?.length && !data.errors?.length && !data.changes?.length) {
        addLine({ type: "system", text: "No file changes were written. See the message above for details." });
      }
    } catch (err: any) {
      addLine({ type: "error", text: `NETWORK ERROR: ${err.message}` });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function clearTerminal() {
    setLines([{ id: "clear", type: "system", text: "Terminal cleared.", timestamp: now() }]);
  }

  return (
    <Card className="border-destructive/40">
      {/* Header */}
      <CardHeader className="border-b border-border/50 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-destructive font-display font-bold text-lg flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            NEXUS REPAIR CORE
            <span className="text-xs font-mono font-normal text-green-400 border border-green-400/30 px-2 py-0.5 rounded">ONLINE</span>
          </CardTitle>
          <button onClick={clearTerminal} className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Clear
          </button>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          AI-powered self-repair — describe what to fix, add, or change in plain language.
        </p>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Mode selector */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Mode:</span>
          <button
            onClick={() => setMode("platform")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-all ${
              mode === "platform"
                ? "border-destructive/60 bg-destructive/10 text-destructive"
                : "border-border/50 text-muted-foreground hover:border-border"
            }`}
          >
            <Cpu className="w-3 h-3" /> Platform Code
          </button>
          <button
            onClick={() => setMode("project")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-all ${
              mode === "project"
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-border/50 text-muted-foreground hover:border-border"
            }`}
          >
            <FileCode2 className="w-3 h-3" /> Project App
          </button>

          {mode === "platform" && (
            <span className="text-xs font-mono text-muted-foreground ml-2">
              Edits <span className="text-destructive">api-server</span> and <span className="text-destructive">ai-studio</span> source files
            </span>
          )}
        </div>

        {mode === "project" && (
          <div className="flex gap-2 items-center">
            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">Project ID:</span>
            <Input
              placeholder="e.g. rqPwThyu7y4x — find in the project URL"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="font-mono text-xs h-8 max-w-sm"
            />
          </div>
        )}

        {/* Terminal output */}
        <div className="bg-black/80 border border-border/40 rounded font-mono text-xs leading-relaxed h-80 overflow-y-auto p-4 space-y-1 scroll-smooth">
          {lines.map((line) => (
            <div key={line.id} className="flex gap-2">
              <span className="text-muted-foreground/40 shrink-0 select-none">{line.timestamp}</span>
              <span className={lineColor(line.type)}>{line.text}</span>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2 items-center">
              <span className="text-muted-foreground/40 shrink-0">{now()}</span>
              <span className="text-yellow-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                AI is analyzing and writing code
                <span className="animate-pulse">…</span>
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <ChevronRight className="absolute left-3 top-3 w-3 h-3 text-primary opacity-60 pointer-events-none" />
            <Textarea
              ref={inputRef}
              placeholder={
                mode === "platform"
                  ? "e.g. Fix the rebuild button not working on mobile  |  Add a dark/light mode toggle to the sidebar  |  The preview iframe is blank — debug and fix it"
                  : "e.g. Add a high score leaderboard  |  Fix the enemy collision detection  |  Add a pause menu"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              className="pl-8 font-mono text-sm resize-none"
              disabled={loading}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="h-full px-4 glow-primary-hover"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>

        {/* Help */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EXAMPLE_COMMANDS[mode].map((ex) => (
            <button
              key={ex}
              onClick={() => setInput(ex)}
              disabled={loading}
              className="text-left text-xs font-mono text-muted-foreground border border-border/30 rounded px-3 py-2 hover:border-primary/40 hover:text-foreground transition-all truncate"
            >
              <ChevronRight className="inline w-3 h-3 mr-1 text-primary/60" />
              {ex}
            </button>
          ))}
        </div>

        {/* Warnings */}
        {mode === "platform" && (
          <div className="flex items-start gap-2 bg-yellow-500/5 border border-yellow-500/20 rounded p-3 text-xs font-mono text-yellow-400/80">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>Platform mode</strong> writes directly to source files. After changes, restart the <em>API Server</em> workflow
              (or <em>Web</em> workflow for frontend edits) for them to take effect. Hot-reload may pick up frontend changes automatically.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function lineColor(type: TerminalLine["type"]) {
  switch (type) {
    case "user":    return "text-cyan-400";
    case "ai":      return "text-green-300";
    case "system":  return "text-gray-400";
    case "error":   return "text-red-400";
    case "success": return "text-green-400";
    case "file":    return "text-blue-400";
    case "warn":    return "text-yellow-400";
    default:        return "text-gray-300";
  }
}

const EXAMPLE_COMMANDS: Record<RepairMode, string[]> = {
  platform: [
    "Fix the deploy button so it shows a success modal after clicking",
    "Add a 'Copy Project ID' button next to the project name",
    "Make the sidebar collapse on mobile screens automatically",
    "Add an error boundary so crashes show a helpful message instead of blank screen",
  ],
  project: [
    "Add a high score board that saves the top 5 scores",
    "Fix the game so enemies don't stack on top of each other",
    "Make the UI dark-themed with neon cyan accents",
    "Add a pause menu when the player presses Escape",
  ],
};
