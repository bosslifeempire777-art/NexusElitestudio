import { AppLayout } from "@/components/layout/AppLayout";
import { useGetMe, useUpdateUser } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from "@/components/ui/cyber-ui";
import { User, Key, Shield, HardDrive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { data: user } = useGetMe();
  const updateMutation = useUpdateUser();
  const { toast } = useToast();

  const handleUpgrade = () => {
    // Mock upgrade to pro
    if(!user) return;
    updateMutation.mutate(
      { id: user.id, data: { plan: 'pro' } },
      {
        onSuccess: () => toast({ title: "System Upgraded", description: "Plan elevated to PRO tier." }),
        onError: () => toast({ title: "Error", variant: "destructive" })
      }
    );
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="border-b border-border/50 pb-6">
          <h1 className="text-3xl font-display font-bold text-glow uppercase">System Settings</h1>
          <p className="text-muted-foreground font-mono mt-2">Configure profile, keys, and subscription tier.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Navigation Sidebar (Mock) */}
          <div className="space-y-2 font-mono text-sm">
            <button className="w-full flex items-center p-3 bg-primary/10 text-primary border border-primary/30 cyber-clip">
              <User className="w-4 h-4 mr-3" /> Profile
            </button>
            <button className="w-full flex items-center p-3 text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent cyber-clip transition-all">
              <Shield className="w-4 h-4 mr-3" /> Subscription
            </button>
            <button className="w-full flex items-center p-3 text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent cyber-clip transition-all">
              <Key className="w-4 h-4 mr-3" /> API Keys
            </button>
             <button className="w-full flex items-center p-3 text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent cyber-clip transition-all">
              <HardDrive className="w-4 h-4 mr-3" /> Data Export
            </button>
          </div>

          {/* Main Content Area */}
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  USER IDENTIFICATION
                  <Badge variant="outline" className="font-mono">{user?.plan.toUpperCase()} TIER</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-mono text-muted-foreground uppercase">Username</label>
                  <Input readOnly value={user?.username || ''} className="bg-background" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-muted-foreground uppercase">Unique Identifier</label>
                  <Input readOnly value={user?.id || ''} className="bg-background text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-accent/30">
              <CardHeader>
                <CardTitle className="text-accent">SUBSCRIPTION STATUS</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-secondary/50 border border-border cyber-clip mb-4">
                  <div>
                    <h4 className="font-display font-bold text-lg mb-1">Current Tier: {user?.plan.toUpperCase()}</h4>
                    <p className="text-xs font-mono text-muted-foreground">
                      {user?.plan === 'free' ? 'Limited agent access. 5 builds remaining.' : 'Unlimited access enabled.'}
                    </p>
                  </div>
                  {user?.plan === 'free' && (
                    <Button onClick={handleUpgrade} className="mt-4 sm:mt-0 glow-accent" variant="accent">
                      Upgrade to PRO
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-destructive">DANGER ZONE</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-mono text-muted-foreground mb-4">
                  Terminating your account will permanently destroy all constructs, source code, and assets. This action cannot be reversed.
                </p>
                <Button variant="destructive">Initiate Self-Destruct</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
