import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge, Button } from "@/components/ui/cyber-ui";
import { Activity, Zap, CreditCard, Loader2, AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useLocation } from "wouter";
import { format } from "date-fns";

type UsageSummary = {
  plan: string;
  periodStart: string;
  builds: {
    used: number;
    limit: number;
    planRemaining: number;
    overageRemaining: number;
    overagePurchased: number;
    totalRemaining: number;
  };
  tokens: { used: number; limit: number };
  estimatedCostCents: number;
  overageAllowed: boolean;
  overagePricePerBuildUsd: number | null;
};

type UsageRecord = {
  id: string;
  kind: string;
  description: string | null;
  units: number;
  createdAt: string;
  projectId: string | null;
};

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

const PACK_OPTIONS = [5, 10, 25, 50];

export default function UsagePage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [packSize, setPackSize] = useState(10);
  const [buying, setBuying] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [, navigate] = useLocation();

  async function load() {
    try {
      setLoading(true);
      const [s, r] = await Promise.all([
        fetch("/api/usage", { headers: authHeaders() }).then(x => x.json()),
        fetch("/api/usage/records?limit=50", { headers: authHeaders() }).then(x => x.json()),
      ]);
      setSummary(s);
      setRecords(Array.isArray(r) ? r : []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // On mount: if returning from a successful overage purchase, claim it
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const overage = params.get("overage");
    if (overage === "success") {
      const sessionId = params.get("session_id") || sessionStorage.getItem("nexus.lastOverageSessionId");
      if (sessionId) {
        fetch("/api/usage/claim-overage", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ sessionId }),
        }).then(r => r.json()).then(data => {
          if (data.ok) setClaimMsg("Build pack added to your account! 🎉");
          else setClaimMsg(`We couldn't activate your pack yet (${data.error || "still processing"}). It'll show up shortly.`);
          sessionStorage.removeItem("nexus.lastOverageSessionId");
          load();
        }).catch(() => setClaimMsg("Couldn't verify the payment yet — refresh in a moment."));
      } else {
        setClaimMsg("Payment received — your pack will appear shortly.");
      }
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
    load();
  }, []);

  async function buyOverage() {
    if (!summary?.overageAllowed) return;
    try {
      setBuying(true);
      const res = await fetch("/api/usage/buy-overage", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ packSize }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "Couldn't start checkout");
        return;
      }
      sessionStorage.setItem("nexus.lastOverageSessionId", data.sessionId);
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBuying(false);
    }
  }

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    </AppLayout>
  );

  const buildsPct = summary && summary.builds.limit > 0
    ? Math.min(100, Math.round((summary.builds.used / summary.builds.limit) * 100))
    : 0;
  const tokensPct = summary && summary.tokens.limit > 0
    ? Math.min(100, Math.round((summary.tokens.used / summary.tokens.limit) * 100))
    : 0;
  const overLimit = summary && summary.builds.limit !== -1 && summary.builds.planRemaining === 0;
  const pricePerBuild = summary?.overagePricePerBuildUsd ?? 0;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Activity className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-display font-bold text-glow">Usage & Billing</h1>
            <p className="text-sm text-muted-foreground font-mono">
              Tracking your AI builds for the period starting{" "}
              {summary && format(new Date(summary.periodStart), "MMM d, yyyy")}
            </p>
          </div>
        </div>

        {claimMsg && (
          <div className="border border-green-400/40 bg-green-500/10 px-4 py-3 rounded flex items-center gap-2 text-green-300 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {claimMsg}
          </div>
        )}
        {error && (
          <div className="border border-red-400/40 bg-red-500/10 px-4 py-3 rounded flex items-center gap-2 text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Plan banner */}
        {summary && (
          <div className="border border-primary/30 bg-secondary/40 cyber-clip p-5 flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Current Plan</p>
              <p className="text-2xl font-display font-bold text-primary">{summary.plan.toUpperCase()}</p>
            </div>
            <Button onClick={() => navigate("/pricing")} className="gap-2">
              <Sparkles className="w-4 h-4" /> Upgrade Plan
            </Button>
          </div>
        )}

        {/* Builds meter */}
        {summary && (
          <div className="border border-border/60 bg-secondary/30 cyber-clip p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-mono uppercase text-muted-foreground tracking-wider">AI Builds This Month</p>
                <p className="text-3xl font-display font-bold mt-1">
                  {summary.builds.used}{" "}
                  <span className="text-base text-muted-foreground">
                    / {summary.builds.limit === -1 ? "Unlimited" : summary.builds.limit}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-mono text-muted-foreground">Remaining (plan)</p>
                <p className="text-xl font-display text-accent">
                  {summary.builds.limit === -1 ? "∞" : summary.builds.planRemaining}
                </p>
                {summary.builds.overageRemaining > 0 && (
                  <p className="text-xs text-green-300 font-mono mt-0.5">
                    + {summary.builds.overageRemaining} bonus from packs
                  </p>
                )}
              </div>
            </div>

            {summary.builds.limit !== -1 && (
              <div className="h-2 bg-background border border-border rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${buildsPct >= 90 ? "bg-red-400" : buildsPct >= 75 ? "bg-yellow-400" : "bg-primary"}`}
                  style={{ width: `${buildsPct}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Tokens meter */}
        {summary && (
          <div className="border border-border/60 bg-secondary/30 cyber-clip p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-mono uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5" /> AI Tokens This Month
                </p>
                <p className="text-2xl font-display font-bold mt-1">
                  {summary.tokens.used.toLocaleString()}{" "}
                  <span className="text-sm text-muted-foreground">
                    / {summary.tokens.limit === -1 ? "Unlimited" : summary.tokens.limit.toLocaleString()}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-mono text-muted-foreground">Estimated Cost</p>
                <p className="text-lg font-display text-accent">${(summary.estimatedCostCents / 100).toFixed(2)}</p>
              </div>
            </div>
            {summary.tokens.limit !== -1 && (
              <div className="h-2 bg-background border border-border rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${tokensPct >= 90 ? "bg-red-400" : tokensPct >= 75 ? "bg-yellow-400" : "bg-accent"}`}
                  style={{ width: `${tokensPct}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Overage purchase */}
        {summary && summary.overageAllowed && (
          <div className={`border ${overLimit ? "border-yellow-400/60 bg-yellow-500/5" : "border-border/60 bg-secondary/30"} cyber-clip p-5 space-y-4`}>
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" />
              <h2 className="font-display font-bold text-lg">Buy a Build Pack</h2>
              {overLimit && <Badge variant="default" className="bg-yellow-500/20 text-yellow-300">Plan limit reached</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {overLimit
                ? `You've used all your monthly builds. Buy extras to keep building right now — no plan change required. Each build is $${pricePerBuild.toFixed(2)} on the ${summary.plan} plan.`
                : `Run out before next month's reset? Pre-buy a pack at $${pricePerBuild.toFixed(2)} per build. Credits never expire.`}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {PACK_OPTIONS.map(n => (
                <Button
                  key={n}
                  size="sm"
                  variant={packSize === n ? "default" : "outline"}
                  onClick={() => setPackSize(n)}
                  className="font-mono"
                >
                  {n} builds · ${(n * pricePerBuild).toFixed(2)}
                </Button>
              ))}
            </div>
            <Button onClick={buyOverage} disabled={buying} className="gap-2">
              {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {buying ? "Starting checkout..." : `Buy ${packSize} builds for $${(packSize * pricePerBuild).toFixed(2)}`}
            </Button>
          </div>
        )}

        {/* Recent activity */}
        <div className="border border-border/60 bg-secondary/30 cyber-clip p-5 space-y-3">
          <h2 className="font-display font-bold text-lg flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" /> Recent Activity
          </h2>
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground font-mono py-6 text-center">No usage yet this period.</p>
          ) : (
            <div className="divide-y divide-border/40 -mx-2">
              {records.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-foreground truncate">{r.description || r.kind}</p>
                    <p className="text-[11px] text-muted-foreground">{format(new Date(r.createdAt), "MMM d, h:mm a")}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase shrink-0">{r.kind}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
