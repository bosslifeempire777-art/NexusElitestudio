import { AppLayout } from "@/components/layout/AppLayout";
import { useListPlans } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Button, Badge } from "@/components/ui/cyber-ui";
import { Check } from "lucide-react";
import { Link } from "wouter";

export default function Pricing() {
  const { data: plans, isLoading } = useListPlans();

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto py-12 text-center">
        <h1 className="text-4xl md:text-5xl font-display font-bold text-glow mb-4">UPGRADE YOUR PROTOCOLS</h1>
        <p className="text-muted-foreground font-mono mb-16 max-w-2xl mx-auto">
          Unlock advanced AI agents, infinite builds, and enterprise-grade deployment pipelines.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          {isLoading ? (
             Array(3).fill(0).map((_, i) => <Card key={i} className="h-[500px] animate-pulse bg-secondary/50" />)
          ) : (
            plans?.filter(p => p.name !== 'admin').map((plan) => {
              const isPro = plan.name === 'pro';
              const isEnterprise = plan.name === 'enterprise';
              
              return (
                <Card 
                  key={plan.id} 
                  className={`relative overflow-visible flex flex-col ${
                    isPro ? 'border-primary shadow-lg shadow-primary/20 scale-105 z-10' : 
                    isEnterprise ? 'border-accent' : 'border-border'
                  }`}
                >
                  {isPro && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <Badge variant="default" className="px-4 py-1 text-sm shadow-lg shadow-primary/50">RECOMMENDED</Badge>
                    </div>
                  )}
                  
                  <CardHeader className="text-center pb-2 pt-8">
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
                  </CardHeader>

                  <CardContent className="flex-1 flex flex-col mt-6">
                    <div className="space-y-4 mb-8 flex-1">
                      {plan.features.map((feature, i) => (
                        <div key={i} className="flex items-start">
                          <Check className={`w-5 h-5 mr-3 shrink-0 ${isPro ? 'text-primary' : isEnterprise ? 'text-accent' : 'text-muted-foreground'}`} />
                          <span className="text-sm font-mono text-[#E0E2EA]">{feature}</span>
                        </div>
                      ))}
                    </div>
                    
                    <Button 
                      asChild 
                      variant={isPro ? 'default' : isEnterprise ? 'accent' : 'outline'} 
                      size="lg" 
                      className="w-full mt-auto"
                    >
                      <Link href="/settings">
                        {plan.price === 0 ? 'Current Plan' : 'Initiate Upgrade'}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </AppLayout>
  );
}
