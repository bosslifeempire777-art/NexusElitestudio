import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@/components/ui/cyber-ui";
import {
  Activity, CheckCircle2, XCircle, Loader2, RefreshCw,
  Hammer, Box, UserPlus, Coins, Cpu, Gauge, AlertTriangle,
} from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { getToken } from "@/lib/auth";

type Event = {
  id: string;
  kind: "signup" | "project" | "build" | "credit";
  ts: string;
  title: string;
  detail: string;
  username: string | null;
  meta: Record<string, any>;
};

type ActivityResponse = {
  events: Event[];
  counts: { users: number; projects: number; builds: number; credits: number };
};

async function fetchActivity(): Promise<ActivityResponse> {
  const token = getToken();
  const res = await fetch("/api/admin/activity?limit=200", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load activity");
  return res.json();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function StatCard({
  label, value, sub, icon: Icon, color,
}: { label: string; value: string | number; sub?: string; icon: any; color: string }) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={`text-3xl font-display font-bold mt-2 ${color}`}>{value}</div>
            {sub && <div className="text-xs font-mono text-muted-foreground mt-1">{sub}</div>}
          </div>
          <Icon className={`w-6 h-6 ${color} opacity-70`} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Diagnostics() {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load() {
    try {
      const r = await fetchActivity();
      setData(r);
      setErr(null);
      setLastUpdated(new Date());
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [auto]);

  const builds = useMemo(() => data?.events.filter(e => e.kind === "build") ?? [], [data]);
  const projects = useMemo(() => data?.events.filter(e => e.kind === "project") ?? [], [data]);
  const signups = useMemo(() => data?.events.filter(e => e.kind === "signup") ?? [], [data]);
  const credits = useMemo(() => data?.events.filter(e => e.kind === "credit") ?? [], [data]);

  const buildStats = useMemo(() => {
    const total = builds.length;
    const succeeded = builds.filter(b => b.meta.status === "succeeded" || b.meta.status === "ready").length;
    const failed = builds.filter(b => b.meta.status === "failed" || b.meta.status === "error").length;
    const running = builds.filter(b => b.meta.status === "building" || b.meta.status === "running" || b.meta.status === "queued").length;
    const successRate = total === 0 ? 0 : Math.round((succeeded / total) * 100);
    return { total, succeeded, failed, running, successRate };
  }, [builds]);

  const projectsByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of projects) {
      const t = p.meta.type || "other";
      map[t] = (map[t] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [projects]);

  const buildsLastHour = useMemo(
    () => builds.filter(b => Date.now() - new Date(b.ts).getTime() < 3_600_000).length,
    [builds]
  );

  const recentBuilds = builds.slice(0, 25);
  const recentEvents = (data?.events ?? []).slice(0, 30);

  function statusColor(s: string) {
    if (s === "succeeded" || s === "ready") return "text-green-400";
    if (s === "failed" || s === "error") return "text-destructive";
    if (s === "building" || s === "running" || s === "queued") return "text-yellow-400";
    return "text-muted-foreground";
  }
  function statusIcon(s: string) {
    if (s === "succeeded" || s === "ready") return CheckCircle2;
    if (s === "failed" || s === "error") return XCircle;
    if (s === "building" || s === "running" || s === "queued") return Loader2;
    return Activity;
  }
  function eventIcon(k: Event["kind"]) {
    if (k === "build") return Hammer;
    if (k === "project") return Box;
    if (k === "signup") return UserPlus;
    if (k === "credit") return Coins;
    return Activity;
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-glow text-primary flex items-center gap-3">
              <Gauge className="w-8 h-8" /> DIAGNOSTICS &amp; BUILD ANALYSIS
            </h1>
            <p className="text-muted-foreground font-mono mt-1 text-sm">
              Live telemetry across every build, project and agent run on the platform.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs font-mono text-muted-foreground">
                Updated {timeAgo(lastUpdated.toISOString())}
              </span>
            )}
            <Button
              variant={auto ? "default" : "outline"}
              size="sm"
              onClick={() => setAuto(a => !a)}
            >
              <Activity className="w-4 h-4 mr-2" />
              {auto ? "AUTO-REFRESH ON" : "AUTO-REFRESH OFF"}
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {err && (
          <Card className="border-destructive/40 bg-destructive/10">
            <CardContent className="p-4 flex items-center gap-3 text-destructive font-mono text-sm">
              <AlertTriangle className="w-5 h-5" /> {err}
            </CardContent>
          </Card>
        )}

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Build Success Rate"
            value={`${buildStats.successRate}%`}
            sub={`${buildStats.succeeded} of ${buildStats.total} recent`}
            icon={CheckCircle2}
            color={buildStats.successRate >= 80 ? "text-green-400" : buildStats.successRate >= 50 ? "text-yellow-400" : "text-destructive"}
          />
          <StatCard
            label="Builds (Last Hour)"
            value={buildsLastHour}
            sub={`${buildStats.running} running now`}
            icon={Hammer}
            color="text-primary"
          />
          <StatCard
            label="Failed Builds"
            value={buildStats.failed}
            sub={buildStats.failed === 0 ? "All clear" : "Investigate below"}
            icon={XCircle}
            color={buildStats.failed === 0 ? "text-green-400" : "text-destructive"}
          />
          <StatCard
            label="New Projects"
            value={projects.length}
            sub={`${signups.length} new signups`}
            icon={Box}
            color="text-cyan-400"
          />
        </div>

        {/* Build success bar */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="w-4 h-4 text-primary" /> Build Pipeline Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-green-400">SUCCEEDED · {buildStats.succeeded}</span>
                  <span className="text-yellow-400">RUNNING · {buildStats.running}</span>
                  <span className="text-destructive">FAILED · {buildStats.failed}</span>
                </div>
                <div className="flex h-3 rounded overflow-hidden bg-secondary/40 border border-border/40">
                  {buildStats.total > 0 && (
                    <>
                      <div className="bg-green-400/80 transition-all" style={{ width: `${(buildStats.succeeded / buildStats.total) * 100}%` }} />
                      <div className="bg-yellow-400/80 transition-all" style={{ width: `${(buildStats.running / buildStats.total) * 100}%` }} />
                      <div className="bg-destructive/80 transition-all" style={{ width: `${(buildStats.failed / buildStats.total) * 100}%` }} />
                    </>
                  )}
                </div>
              </div>

              {projectsByType.length > 0 && (
                <div className="pt-2">
                  <div className="text-xs font-mono uppercase text-muted-foreground mb-2">Project Type Breakdown</div>
                  <div className="flex flex-wrap gap-2">
                    {projectsByType.map(([type, count]) => (
                      <Badge key={type} variant="outline" className="font-mono">
                        {type} <span className="ml-2 text-primary">{count}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Two-column lower section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent builds */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Hammer className="w-4 h-4 text-primary" /> Recent Builds
                <Badge variant="outline" className="ml-auto font-mono text-xs">{recentBuilds.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentBuilds.length === 0 ? (
                <div className="text-sm font-mono text-muted-foreground py-6 text-center">No builds yet.</div>
              ) : (
                <div className="space-y-1.5 max-h-[440px] overflow-y-auto pr-1">
                  {recentBuilds.map(b => {
                    const Icon = statusIcon(b.meta.status);
                    const spinning = b.meta.status === "building" || b.meta.status === "running" || b.meta.status === "queued";
                    return (
                      <div key={b.id} className="flex items-center gap-3 px-3 py-2 bg-secondary/30 border border-border/40 rounded text-sm">
                        <Icon className={`w-4 h-4 shrink-0 ${statusColor(b.meta.status)} ${spinning ? "animate-spin" : ""}`} />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs truncate">{b.detail}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {b.username ?? "system"} · {timeAgo(b.ts)}
                          </div>
                        </div>
                        <span className={`text-[10px] font-mono uppercase ${statusColor(b.meta.status)}`}>
                          {b.meta.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Live event feed */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="w-4 h-4 text-primary" /> Live Event Feed
                {auto && <span className="ml-1 inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentEvents.length === 0 ? (
                <div className="text-sm font-mono text-muted-foreground py-6 text-center">Awaiting events...</div>
              ) : (
                <div className="space-y-1.5 max-h-[440px] overflow-y-auto pr-1">
                  {recentEvents.map(e => {
                    const Icon = eventIcon(e.kind);
                    return (
                      <div key={e.id} className="flex items-start gap-3 px-3 py-2 bg-secondary/20 border border-border/30 rounded text-sm">
                        <Icon className="w-4 h-4 shrink-0 text-primary mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs">
                            <span className="font-medium">{e.title}</span>
                            <span className="text-muted-foreground ml-2 font-mono">{e.detail}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                            {e.username ?? "—"} · {timeAgo(e.ts)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
