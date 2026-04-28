import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListPlans } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Button, Badge } from "@/components/ui/cyber-ui";
import {
  Check, Loader2, Crown, Zap, Rocket, Building2, Star,
  ArrowRight, Sparkles, TrendingUp, Shield, Users, Flame,
  AlertCircle, X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getToken } from "@/lib/auth";

function usePromo() {
  const [promo, setPromo] = useState<{ active: boolean; discountPercent: number; endsAt: number } | null>(null);
  useEffect(() => {
    fetch("/api/stripe/promo").then(r => r.json()).then(setPromo).catch(() => {});
  }, []);
  return promo;
}

const PLAN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  free:    Star,
  starter: Zap,
  pro:     Rocket,
  elite:   Building2,
  vip:     Crown,
};

const PLAN_GRADIENT: Record<string, string> = {
  free:    "from-border/20 to-transparent",
  starter: "from-primary/10 to-transparent",
  pro:     "from-accent/10 to-transparent",
  elite:   "from-yellow-500/10 to-transparent",
};

const PLAN_COLOR: Record<string, string> = {
  free:    "text-muted-foreground",
  starter: "text-primary",
  pro:     "text-accent",
  elite:   "text-yellow-400",
};

const OVERAGE_DISPLAY: Record<string, string> = {
  starter: "$2 / extra build",
  pro:     "$1.50 / extra build",
};

export default function Pricing() {
  const { data: plans, isLoading } = useListPlans();
  const { user } = useAuth();
  const promo = usePromo();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError]     = useState<string | null>(null);
  const [cancelNotice, setCancelNotice]       = useState<{ plan: string | null } | null>(null);

  // Detect Stripe cancel-return (?upgrade=cancel[&plan=...]) so we can show a
  // helpful "we noticed you didn't finish — try another card or payment method"
  // message instead of silently dropping the visitor back on the pricing page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgrade") === "cancel") {
      setCancelNotice({ plan: params.get("plan") });
      params.delete("upgrade");
      params.delete("plan");
      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  const userPlan = user?.plan || "free";
  const displayPlans = plans?.filter(p => p.name !== "vip") ?? [];
  const promoActive = promo?.active === true;

  async function handleUpgrade(planName: string) {
    if (!user) { window.location.href = "/login"; return; }

    setCheckoutLoading(planName);
    setCheckoutError(null);
    try {
      const token = getToken();
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ planName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.url) {
        // Open Stripe checkout in a new tab — works from both iframe previews and direct browser visits
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      setCheckoutError(err.message || "Something went wrong. Please try again.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto py-12">

        {/* Header */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-mono mb-4">
            <Sparkles className="w-3.5 h-3.5" /> NEXUSELITE PRICING
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-glow mb-4">
            UPGRADE YOUR PROTOCOLS
          </h1>
          <p className="text-muted-foreground font-mono max-w-2xl mx-auto">
            Build websites, mobile apps, SaaS products, and games with 21 AI agents.
            Pay as you grow — overage charges keep you building even after your monthly limit.
          </p>
          {user && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-1.5 rounded border border-border/30 bg-secondary/20 text-xs font-mono">
              Current plan: <span className={`font-bold uppercase ${PLAN_COLOR[userPlan] || "text-foreground"}`}>{userPlan}</span>
              {user.isVip && <span className="text-yellow-400 font-bold ml-1">• VIP ACCESS</span>}
              {user.buildsThisMonth !== undefined && (
                <span className="text-muted-foreground/60 ml-2">
                  • {user.buildsThisMonth} builds used this month
                </span>
              )}
            </div>
          )}
        </div>

        {cancelNotice && (
          <div className="mb-6 max-w-2xl mx-auto bg-yellow-500/5 border border-yellow-500/40 rounded-lg px-5 py-4 font-mono">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-yellow-300 mb-1">
                  Your payment didn't go through
                </p>
                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                  {cancelNotice.plan
                    ? <>Your <span className="text-yellow-300 font-bold uppercase">{cancelNotice.plan}</span> upgrade wasn't completed. </>
                    : <>Your upgrade wasn't completed. </>}
                  If your card was declined, try a different card — or use Cash App, Link, or your bank account on the next screen. Tap your plan again to try again.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCancelNotice(null)}
                className="text-muted-foreground/50 hover:text-foreground shrink-0 -mt-1 -mr-1 p-1"
                aria-label="Dismiss"
                data-testid="button-dismiss-cancel-notice"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {checkoutError && (
          <div className="mb-8 max-w-lg mx-auto bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 text-sm text-destructive font-mono text-center">
            {checkoutError}
          </div>
        )}

        {/* Plans grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch mb-16">
          {isLoading
            ? Array(4).fill(0).map((_, i) => <Card key={i} className="h-[600px] animate-pulse bg-secondary/30" />)
            : displayPlans.map((plan: any) => {
                const isPro       = plan.name === "pro";
                const isElite     = plan.name === "elite";
                const isStarter   = plan.name === "starter";
                const isCurrent   = userPlan === plan.name;
                const isDowngrade = ["pro","elite","starter"].indexOf(plan.name) <
                                    ["pro","elite","starter"].indexOf(userPlan);
                const PlanIcon = PLAN_ICONS[plan.name] || Star;
                const loading  = checkoutLoading === plan.name;

                return (
                  <Card
                    key={plan.id}
                    className={`relative flex flex-col overflow-hidden transition-all ${
                      isPro     ? "border-accent/60 shadow-lg shadow-accent/10 ring-1 ring-accent/20" :
                      isElite   ? "border-yellow-500/40 shadow-lg shadow-yellow-500/10" :
                      isStarter ? "border-primary/40" :
                      "border-border/40"
                    } ${isCurrent ? "ring-2 ring-primary/40" : ""}`}
                  >
                    {/* Gradient top strip */}
                    <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${
                      isPro ? "from-accent to-accent/30" : isElite ? "from-yellow-400 to-yellow-400/30" : isStarter ? "from-primary to-primary/30" : "from-border to-transparent"
                    }`} />

                    {isPro && !isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                        <Badge className="bg-accent text-background text-[10px] px-3 shadow-lg">MOST POPULAR</Badge>
                      </div>
                    )}
                    {isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                        <Badge variant="outline" className="border-primary/50 text-primary text-[10px] px-3 bg-background">YOUR PLAN</Badge>
                      </div>
                    )}

                    <CardHeader className={`pt-8 pb-4 bg-gradient-to-b ${PLAN_GRADIENT[plan.name] || ""}`}>
                      <PlanIcon className={`w-7 h-7 mb-3 ${PLAN_COLOR[plan.name] || "text-foreground"}`} />
                      <h3 className={`font-display font-bold text-xl uppercase tracking-widest ${PLAN_COLOR[plan.name] || "text-foreground"}`}>
                        {plan.displayName}
                      </h3>
                      <p className="text-[11px] text-muted-foreground/60 font-mono mt-0.5">
                        {plan.tagline || ""}
                      </p>

                      <div className="mt-4 flex items-baseline gap-0.5">
                        {plan.price === 0
                          ? <span className="text-4xl font-display font-black text-muted-foreground">Free</span>
                          : promoActive
                            ? <>
                                <div className="flex flex-col">
                                  <div className="flex items-baseline gap-1">
                                    <span className="text-lg font-bold mt-1 text-accent">$</span>
                                    <span className="text-4xl font-display font-black text-accent">
                                      {Math.round(plan.price * 0.5)}
                                    </span>
                                    <span className="text-muted-foreground font-mono text-sm ml-1">/first mo</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-muted-foreground/50 font-mono text-sm line-through">${plan.price}/mo</span>
                                    <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-mono font-bold">
                                      50% OFF
                                    </span>
                                  </div>
                                </div>
                              </>
                            : <>
                                <span className="text-lg font-bold mt-1">$</span>
                                <span className="text-4xl font-display font-black">{plan.price}</span>
                                <span className="text-muted-foreground font-mono text-sm ml-1">/mo</span>
                              </>
                        }
                      </div>

                      {OVERAGE_DISPLAY[plan.name] && (
                        <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
                          <TrendingUp className="w-2.5 h-2.5 text-primary" />
                          <span className="text-[10px] font-mono text-primary">{OVERAGE_DISPLAY[plan.name]} overage</span>
                        </div>
                      )}
                    </CardHeader>

                    <CardContent className="flex-1 flex flex-col pt-2 pb-6">
                      <ul className="space-y-2.5 mb-6 flex-1">
                        {plan.features?.map((feature: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${PLAN_COLOR[plan.name] || "text-muted-foreground"}`} />
                            <span className="text-[12px] font-mono text-[#C8CAD4] leading-snug">{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {isCurrent ? (
                        <Button variant="outline" className="w-full opacity-60 cursor-default text-xs" disabled>
                          Active Plan
                        </Button>
                      ) : plan.price === 0 ? (
                        <Button variant="outline" className="w-full text-xs opacity-50" disabled>
                          Free Tier
                        </Button>
                      ) : (
                        <Button
                          className={`w-full text-xs font-bold flex items-center justify-center gap-2 ${
                            isPro     ? "bg-accent hover:bg-accent/90 text-background" :
                            isElite   ? "bg-yellow-500 hover:bg-yellow-400 text-background" :
                            isStarter ? "" : ""
                          } ${promoActive && !isDowngrade ? "ring-2 ring-red-500/50" : ""}`}
                          variant={isPro || isElite ? "default" : "outline"}
                          disabled={loading || !!checkoutLoading}
                          onClick={() => handleUpgrade(plan.name)}
                        >
                          {loading
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Redirecting…</>
                            : isDowngrade
                              ? <><ArrowRight className="w-3.5 h-3.5" /> Switch Plan</>
                              : promoActive
                                ? <><Flame className="w-3.5 h-3.5 text-orange-400" /> 50% OFF — Upgrade Now</>
                                : <><ArrowRight className="w-3.5 h-3.5" /> Upgrade Now</>
                          }
                        </Button>
                      )}

                      {plan.price > 0 && !isCurrent && (
                        <p className="text-[9px] text-muted-foreground/40 font-mono text-center mt-2">
                          Billed monthly • Cancel anytime • 30-day guarantee
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })
          }
        </div>

        {/* Usage / Overage explanation */}
        <div className="mb-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border border-border/30 rounded-xl p-5 bg-secondary/10">
            <TrendingUp className="w-6 h-6 text-primary mb-3" />
            <h3 className="font-display font-bold text-sm mb-2">Pay-As-You-Go Overages</h3>
            <p className="text-xs text-muted-foreground/70 font-mono leading-relaxed">
              Starter and Pro users keep building after their monthly limit — you're just charged a small overage per extra build. No surprise shutdowns.
            </p>
          </div>
          <div className="border border-border/30 rounded-xl p-5 bg-secondary/10">
            <Shield className="w-6 h-6 text-accent mb-3" />
            <h3 className="font-display font-bold text-sm mb-2">Marketplace Access</h3>
            <p className="text-xs text-muted-foreground/70 font-mono leading-relaxed">
              Pro and Elite members can list their apps and games on the NexusElite Marketplace — we actively promote and help market your products.
            </p>
          </div>
          <div className="border border-border/30 rounded-xl p-5 bg-secondary/10">
            <Users className="w-6 h-6 text-yellow-400 mb-3" />
            <h3 className="font-display font-bold text-sm mb-2">Elite Scale</h3>
            <p className="text-xs text-muted-foreground/70 font-mono leading-relaxed">
              Elite gives you unlimited everything — builds, projects, deployments — plus a dedicated account manager and white-label options.
            </p>
          </div>
        </div>

        {/* Comparison table */}
        <div className="mb-16 border border-border/30 rounded-xl overflow-hidden">
          <div className="bg-secondary/20 px-6 py-3 border-b border-border/30">
            <h2 className="font-display font-bold text-sm tracking-widest">FULL FEATURE COMPARISON</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border/20">
                  <th className="text-left px-6 py-3 text-muted-foreground font-normal w-1/3">Feature</th>
                  {["Free","Starter","Pro","Elite"].map(n => (
                    <th key={n} className="px-4 py-3 text-center font-bold" style={{
                      color: n === "Starter" ? "hsl(var(--primary))" : n === "Pro" ? "hsl(var(--accent))" : n === "Elite" ? "#facc15" : undefined
                    }}>{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Monthly Price",            "Free",   "$29",  "$60",    "$269"],
                  ["Builds / month",           "3",      "20",   "75",     "Unlimited"],
                  ["Projects",                 "2",      "10",   "30",     "Unlimited"],
                  ["Deployments",              "—",      "20",   "Unlimited","Unlimited"],
                  ["Overage rate",             "—",      "$2/build","$1.50/build","—"],
                  ["All 21 AI Agents",         "5 only", "✓",    "✓",      "✓"],
                  ["Game Studio",              "—",      "✓",    "✓",      "✓"],
                  ["Custom Domain + SSL",      "—",      "✓",    "✓",      "✓"],
                  ["Marketplace Listing",      "—",      "—",    "✓",      "✓"],
                  ["Marketing & Promotion",    "—",      "—",    "✓",      "✓"],
                  ["Team Members",             "1",      "1",    "3",      "10"],
                  ["White-Label Options",      "—",      "—",    "—",      "✓"],
                  ["Dedicated Account Manager","—",      "—",    "—",      "✓"],
                  ["SLA Guarantee",            "—",      "—",    "—",      "✓"],
                ].map(([feature, free, starter, pro, elite]) => (
                  <tr key={feature} className="border-b border-border/10 hover:bg-secondary/10 transition-colors">
                    <td className="px-6 py-2.5 text-muted-foreground">{feature}</td>
                    {[free, starter, pro, elite].map((val, i) => (
                      <td key={i} className="px-4 py-2.5 text-center">
                        {val === "✓" ? <span className="text-green-400 font-bold">✓</span> :
                         val === "—" ? <span className="text-muted-foreground/30">—</span> :
                         <span>{val}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* VIP Section */}
        <div className="border border-yellow-500/20 bg-gradient-to-br from-yellow-500/5 to-transparent rounded-2xl p-8 text-center max-w-2xl mx-auto mb-8">
          <Crown className="w-10 h-10 text-yellow-400 mx-auto mb-4" />
          <h3 className="font-display font-bold text-xl text-yellow-400 mb-2">VIP ACCESS</h3>
          <p className="text-sm text-muted-foreground/70 font-mono leading-relaxed">
            VIP accounts receive complete Elite-level access — completely free — granted directly by the platform owner. 
            VIP status includes a badge, unlimited usage, and direct founder access.
          </p>
          <p className="text-[10px] text-muted-foreground/40 mt-3 font-mono">
            VIP is by invitation only and cannot be purchased.
          </p>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display font-bold text-center text-sm tracking-widest text-muted-foreground mb-6">COMMON QUESTIONS</h2>
          <div className="space-y-4">
            {[
              ["What counts as a 'build'?", "Every time the AI generates or rebuilds a full project for you, that's one build. Quick chat-based edits to existing projects don't count against your limit."],
              ["What are overage charges?", "On Starter and Pro plans, once you hit your monthly build limit, you can keep building — each extra build costs $2 (Starter) or $1.50 (Pro). Charges appear on your next monthly invoice."],
              ["How does Marketplace work?", "Pro and Elite members can list their finished apps, games, and tools for sale or showcase on NexusElite Marketplace. We also actively market and promote Pro+ listings."],
              ["Can I cancel anytime?", "Yes. Cancel any time from your settings — you keep full access until the end of your billing period. No lock-in contracts."],
              ["What's the 30-day guarantee?", "If you're not satisfied within 30 days of your first payment, contact us for a full refund — no questions asked."],
            ].map(([q, a]) => (
              <div key={q} className="border border-border/30 rounded-lg p-4">
                <p className="font-bold text-sm mb-1.5">{q}</p>
                <p className="text-xs text-muted-foreground/70 font-mono leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
