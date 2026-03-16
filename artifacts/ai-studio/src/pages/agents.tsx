import { AppLayout } from "@/components/layout/AppLayout";
import { useListAgents } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Badge } from "@/components/ui/cyber-ui";
import { BrainCircuit, Cpu, Database, LayoutTemplate, ShieldCheck, Gamepad2, LineChart, Server } from "lucide-react";

const iconMap: Record<string, any> = {
  software: Cpu,
  design: LayoutTemplate,
  database: Database,
  security: ShieldCheck,
  game_studio: Gamepad2,
  business: LineChart,
  devops: Server,
  ai: BrainCircuit
};

export default function Agents() {
  const { data: agents, isLoading } = useListAgents();

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 border-b border-border/50 pb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-glow uppercase">Agent Swarm</h1>
            <p className="text-muted-foreground font-mono mt-2">Active intelligence units available for deployment.</p>
          </div>
          <img 
            src={`${import.meta.env.BASE_URL}images/agent-core.png`} 
            alt="Core" 
            className="w-16 h-16 object-contain mix-blend-screen opacity-80" 
          />
        </div>

        {/* Group by category */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 animate-pulse">
            {[1,2,3,4,5,6,7,8].map(i => <Card key={i} className="h-40 bg-secondary/50" />)}
          </div>
        ) : (
          <div className="space-y-12">
            {['software', 'game_studio', 'devops', 'design', 'business', 'security', 'database'].map(category => {
              const categoryAgents = agents?.filter(a => a.category === category);
              if (!categoryAgents?.length) return null;
              
              const Icon = iconMap[category] || Cpu;

              return (
                <div key={category}>
                  <h2 className="text-xl font-display font-semibold mb-4 flex items-center uppercase text-primary border-b border-primary/20 pb-2 inline-flex cyber-clip pr-8">
                    <Icon className="w-5 h-5 mr-3" />
                    {category.replace('_', ' ')}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {categoryAgents.map(agent => (
                      <Card key={agent.id} className="group relative overflow-visible border-border hover:border-primary/50 transition-colors">
                        <div className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center z-10">
                           <div className={`w-2 h-2 rounded-full ${agent.status === 'idle' ? 'bg-muted-foreground' : 'bg-green-500 animate-pulse'}`} />
                        </div>
                        <CardHeader className="pb-2">
                          <div className="flex items-center space-x-3 mb-2">
                            <div className="p-2 bg-secondary/50 rounded cyber-clip border border-border/50 text-accent group-hover:glow-accent transition-all">
                              <Icon className="w-6 h-6" />
                            </div>
                            <h3 className="font-display font-bold text-foreground group-hover:text-primary transition-colors truncate">
                              {agent.name}
                            </h3>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-xs font-mono text-muted-foreground mb-4 line-clamp-2 h-8">
                            {agent.description}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {agent.capabilities.slice(0, 3).map(cap => (
                              <Badge key={cap} variant="secondary" className="text-[10px] bg-background">
                                {cap}
                              </Badge>
                            ))}
                            {agent.capabilities.length > 3 && (
                              <Badge variant="secondary" className="text-[10px] bg-background">+{agent.capabilities.length - 3}</Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
