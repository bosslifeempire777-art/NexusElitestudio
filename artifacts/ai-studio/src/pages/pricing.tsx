import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListPlans } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Button, Badge } from "@/components/ui/cyber-ui";
import { Check, Loader2, Crown, Zap, Building2, Star } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getToken } from "@/lib/auth";

const PLAN_STRIPE_IDS: Record<string, string> = {
  // These will match Stripe price IDs once connected — left empty until Stripe is set up
  pro: "",
  enterprise: "",
};

const PLAN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  free:       Star,
  pro:        Zap,
  enterprise: Building2,
  vip:        Crown,
};

export default function Pricing() {
  const { data: plans, isLoading } = useListPlans();
  const { user } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError]     = useState<string | null>(null);

  async function handleUpgrade(planName: string, priceId: string) {
    if (!priceId) {
      setCheckoutError("Payment is being set up. Contact support to upgrade now.");
      return;
    }
    if (!user) {
      window.location.href = "/login";
      return;
    }

    setCheckoutLoading(planName);
    setCheckoutError(null);

    try {
      const token = getToken();
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ priceId, planName }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      setCheckoutError(err.message || "Something went wrong. Please try again.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  const userPlan = user?.plan || "free";

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto py-12 text-center">
        <h1 className="text-4xl md:text-5xl font-display font-bold text-glow mb-4">UPGRADE YOUR PROTOCOLS</h1>
        <p className="text-muted-foreground font-mono mb-4 max-w-2xl mx-auto">
          Unlock advanced AI agents, infinite builds, and enterprise-grade deployment pipelines.
        </p>
        {user && (
          <p className="text-xs text-muted-foreground/60 font-mono mb-12">
            Current plan: <span className="text-primary font-bold uppercase">{userPlan}</span>
            {user.isVip && <span className="ml-2 text-accent">• VIP ACCESS</span>}
          </p>
        )}

        {checkoutError && (
          <div className="mb-8 max-w-lg mx-auto bg-destructive/10 border border-destructive/30 rounded px-4 py-3 text-sm text-destructive font-mono">
            {checkoutError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => (
              <Card key={i} className="h-[500px] animate-pulse bg-secondary/50" />
            ))
          ) : (
            plans?.filter(p => p.name !== 'admin' && p.name !== 'vip').map((plan) => {
              const isPro       = plan.name === 'pro';
              const isEnterprise = plan.name === 'enterprise';
              const isCurrent   = userPlan === plan.name;
              const PlanIcon    = PLAN_ICONS[plan.name] || Star;
              const priceId     = PLAN_STRIPE_IDS[plan.name] || "";
              const loading     = checkoutLoading === plan.name;

              return (
                <Card
                  key={plan.id}
                  className={`relative overflow-visible flex flex-col ${
                    isPro       ? 'border-primary shadow-lg shadow-primary/20 scale-105 z-10' :
                    isEnterprise ? 'border-accent/60' :
                    'border-border'
                  } ${isCurrent ? 'ring-2 ring-primary/40' : ''}`}
                >
                  {isPro && !isCurrent && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <Badge variant="default" className="px-4 py-1 text-sm shadow-lg shadow-primary/50">
                        RECOMMENDED
                      </Badge>
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <Badge variant="outline" className="px-4 py-1 text-sm border-primary/50 text-primary">
                        YOUR PLAN
                      </Badge>
                    </div>
                  )}

                  <CardHeader className="text-center pb-2 pt-8">
                    <PlanIcon className={`w-8 h-8 mx-auto mb-3 ${isPro ? 'text-primary' : isEnterprise ? 'text-accent' : 'text-muted-foreground'}`} />
                    <h3 className={`font-display font-bold text-2xl uppercase tracking-widest ${
                      isPro ? 'text-primary' : isEnterprise ? 'text-accent' : 'text-foreground'
                    }`}>
                      {plan.displayName}
                    </h3>
                    <div className="mt-4 flex items-baseline justify-center">
                      <span className="text-3xl font-bold">$</span>
                      <span className="text-5xl font-display font-black">{plan.price}</span>
                      <span className="text-muted-foreground font-mono ml-2">/mo</span>
                    </div>
                    {plan.price > 0 && (
                      <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
                        billed monthly • cancel anytime
                      </p>
                    )}
                  </CardHeader>

                  <CardContent className="flex-1 flex flex-col mt-6">
                    <div className="space-y-3 mb-8 flex-1">
                      {plan.features.map((feature: string, i: number) => (
                        <div key={i} className="flex items-start">
                          <Check className={`w-4 h-4 mr-3 shrink-0 mt-0.5 ${isPro ? 'text-primary' : isEnterprise ? 'text-accent' : 'text-muted-foreground'}`} />
                          <span className="text-sm font-mono text-[#E0E2EA]">{feature}</span>
                        </div>
                      ))}
                    </div>

                    {isCurrent ? (
                      <Button variant="outline" size="lg" className="w-full mt-auto opacity-60 cursor-default" disabled>
                        Active Plan
                      </Button>
                    ) : plan.price === 0 ? (
                      <Button variant="outline" size="lg" className="w-full mt-auto" disabled>
                        Free Tier
                      </Button>
                    ) : (
                      <Button
                        variant={isPro ? 'default' : isEnterprise ? 'accent' : 'outline'}
                        size="lg"
                        className="w-full mt-auto"
                        disabled={loading || !!checkoutLoading}
                        onClick={() => handleUpgrade(plan.name, priceId)}
                      >
                        {loading ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting…</>
                        ) : (
                          "Initiate Upgrade"
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* VIP note */}
        <div className="mt-16 border border-accent/20 bg-accent/5 rounded-xl p-6 max-w-2xl mx-auto">
          <Crown className="w-8 h-8 text-accent mx-auto mb-3" />
          <h3 className="font-display font-bold text-lg text-accent mb-2">VIP ACCESS</h3>
          <p className="text-sm text-muted-foreground font-mono">
            VIP accounts get unlimited access to all features completely free. 
            VIP status is granted by the platform owner.
          </p>
        </div>

        {/* Money-back guarantee */}
        <p className="mt-8 text-xs text-muted-foreground/40 font-mono">
          30-day money-back guarantee • Secure payment via Stripe • Upgrade or cancel anytime
        </p>
      </div>
    </AppLayout>
  );
}
