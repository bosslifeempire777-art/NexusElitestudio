import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiBase } from "@/lib/api";
import { cn } from "@/components/ui/cyber-ui";
import {
  Gift, Copy, Check, Users, TrendingUp, Zap, Star,
  ChevronRight, Clock, Award, RefreshCw
} from "lucide-react";

interface ReferralStats {
  referralCode: string;
  referralLink: string;
  creditBalance: number;
  stats: { totalSignups: number; totalConverted: number };
  creditRules: { signup: number; converted: number; monthly: number };
  redemptionOptions: { id: string; label: string; cost: number; plan: string }[];
  transactions: { id: string; amount: number; type: string; description: string; createdAt: string }[];
  referrals: { id: string; status: string; createdAt: string }[];
}

export default function ReferPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const token = localStorage.getItem("nexus-token");
      const r = await fetch(`${apiBase}/api/referrals/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function copyLink() {
    if (!data) return;
    navigator.clipboard.writeText(data.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function redeem(optionId: string, cost: number) {
    if (!data || data.creditBalance < cost) return;
    setRedeeming(optionId);
    setRedeemMsg(null);
    try {
      const token = localStorage.getItem("nexus-token");
      const r = await fetch(`${apiBase}/api/referrals/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ optionId }),
      });
      const json = await r.json();
      if (r.ok) {
        setRedeemMsg(`Redeemed! Your plan is now ${json.plan.toUpperCase()}.`);
        await load();
      } else {
        setRedeemMsg(json.error || "Redemption failed");
      }
    } finally {
      setRedeeming(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-muted-foreground text-center py-20">Failed to load referral data.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary text-xs font-mono mb-2">
          <Gift className="w-3.5 h-3.5" />
          REFER & EARN
        </div>
        <h1 className="text-3xl font-display font-bold tracking-tight">
          Share NexusElite — <span className="text-primary">Earn Credits</span>
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Every person you bring earns you credits. When they upgrade to a paid plan, you earn even more. Redeem credits for free plan time.
        </p>
      </div>

      {/* Credit Balance + Link */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Balance card */}
        <div className="bg-card border border-primary/30 rounded-lg p-6 cyber-clip flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-widest">
            <Zap className="w-3.5 h-3.5 text-primary" />
            Credit Balance
          </div>
          <div className="text-5xl font-display font-bold text-primary glow-primary">
            {(data.creditBalance ?? 0).toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground">credits available to redeem</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card border border-border/50 rounded-lg p-4 cyber-clip">
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-2">
              <Users className="w-3.5 h-3.5" />
              Signups
            </div>
            <div className="text-3xl font-display font-bold">{data.stats.totalSignups}</div>
          </div>
          <div className="bg-card border border-border/50 rounded-lg p-4 cyber-clip">
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
              Paid
            </div>
            <div className="text-3xl font-display font-bold text-green-400">{data.stats.totalConverted}</div>
          </div>
        </div>
      </div>

      {/* Referral Link */}
      <div className="bg-card border border-border/50 rounded-lg p-5 space-y-3">
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Your Referral Link</p>
        <div className="flex items-center gap-3 bg-secondary/40 rounded border border-border/50 px-4 py-3">
          <span className="flex-1 text-sm font-mono text-primary truncate">{data.referralLink}</span>
          <button
            onClick={copyLink}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-all",
              copied
                ? "bg-green-500/20 border-green-500/40 text-green-400"
                : "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
            )}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Share this link anywhere — social media, Discord, forums, YouTube — and earn every time someone signs up through it.
        </p>
      </div>

      {/* How it works */}
      <div className="bg-card border border-border/50 rounded-lg p-5 space-y-4">
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest">How Credits Work</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: Users, label: "Someone signs up", value: `+${data.creditRules.signup}`, color: "text-blue-400", border: "border-blue-500/30" },
            { icon: Star, label: "They upgrade to paid", value: `+${data.creditRules.converted}`, color: "text-yellow-400", border: "border-yellow-500/30" },
            { icon: TrendingUp, label: "They stay subscribed / mo", value: `+${data.creditRules.monthly}`, color: "text-green-400", border: "border-green-500/30" },
          ].map(({ icon: Icon, label, value, color, border }) => (
            <div key={label} className={cn("flex items-center gap-3 p-4 rounded border bg-secondary/20", border)}>
              <Icon className={cn("w-5 h-5 shrink-0", color)} />
              <div>
                <div className={cn("text-lg font-display font-bold", color)}>{value} credits</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Redemption options */}
      <div className="bg-card border border-border/50 rounded-lg p-5 space-y-4">
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Redeem Credits</p>
        {redeemMsg && (
          <div className={cn(
            "text-sm px-4 py-2 rounded border font-mono",
            redeemMsg.startsWith("Redeemed")
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          )}>
            {redeemMsg}
          </div>
        )}
        <div className="space-y-3">
          {data.redemptionOptions.map(opt => {
            const canRedeem = data.creditBalance >= opt.cost;
            const isRedeeming = redeeming === opt.id;
            return (
              <div
                key={opt.id}
                className={cn(
                  "flex items-center justify-between p-4 rounded border transition-all",
                  canRedeem ? "border-primary/30 bg-primary/5" : "border-border/40 bg-secondary/10 opacity-60"
                )}
              >
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground font-mono">{opt.cost.toLocaleString()} credits</div>
                </div>
                <button
                  onClick={() => redeem(opt.id, opt.cost)}
                  disabled={!canRedeem || isRedeeming}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 text-sm font-mono rounded border transition-all",
                    canRedeem
                      ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 cursor-pointer"
                      : "border-border/30 text-muted-foreground cursor-not-allowed"
                  )}
                >
                  {isRedeeming ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Award className="w-3.5 h-3.5" />}
                  {isRedeeming ? "Redeeming..." : "Redeem"}
                  {canRedeem && !isRedeeming && <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Transaction history */}
      {data.transactions.length > 0 && (
        <div className="bg-card border border-border/50 rounded-lg p-5 space-y-3">
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Credit History</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.transactions.map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-3">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-sm">{tx.description}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className={cn("font-mono font-bold text-sm", tx.amount > 0 ? "text-green-400" : "text-destructive")}>
                  {tx.amount > 0 ? "+" : ""}{tx.amount}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
