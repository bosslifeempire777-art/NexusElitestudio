import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@/components/ui/cyber-ui";
import { useListProjects, useGetUserAnalytics } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Plus, Terminal, Activity, Zap, Database, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";

const PLAN_LIMITS: Record<string, { builds: number; projects: number; deployments: number }> = {
  free:    { builds: 3,  projects: 2,  deployments: 0 },
  starter: { builds: 20, projects: 10, deployments: -1 },
  pro:     { builds: 75, projects: -1, deployments: -1 },
  elite:   { builds: -1, projects: -1, deployments: -1 },
  vip:     { builds: -1, projects: -1, deployments: -1 },
};

export default function Dashboard() {
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { data: analytics } = useGetUserAnalytics();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const planLimits = PLAN_LIMITS[user?.plan ?? "free"] ?? PLAN_LIMITS.free;
  const isLimitedPlan = user?.plan === "free" || user?.plan === "starter";
  const buildsUsed   = user?.buildsThisMonth ?? 0;
  const projectsUsed = user?.projectCount ?? 0;
  const buildsLimit   = planLimits.builds;
  const projectsLimit = planLimits.projects;
  const buildsNearLimit   = buildsLimit > 0 && buildsUsed >= Math.floor(buildsLimit * 0.8);
  const projectsNearLimit = projectsLimit > 0 && projectsUsed >= Math.floor(projectsLimit * 0.8);
  const showUsageBanner   = isLimitedPlan && !user?.isAdmin && !user?.isVip;

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'deployed': return 'default';
      case 'ready': return 'outline';
      case 'building': return 'secondary';
      case 'failed': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-glow">COMMAND CENTER</h1>
            <p className="text-muted-foreground font-mono mt-1 text-sm">System status: <span className="text-primary">Nominal</span></p>
          </div>
          <Button asChild className="glow-primary-hover">
            <Link href="/projects/new"><Plus className="w-4 h-4 mr-2"/> New Construct</Link>
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard title="Active Projects" value={analytics?.projectsCreated || 0} icon={Database} color="text-primary" />
          <StatCard title="Builds This Month" value={analytics?.buildsThisMonth || 0} icon={Activity} color="text-accent" />
          <StatCard title="Total Deployments" value={analytics?.totalDeployments || 0} icon={Zap} color="text-green-400" />
          <StatCard title="AI Tokens Used" value={analytics?.aiTokensUsed?.toLocaleString() || 0} icon={Terminal} color="text-muted-foreground" />
        </div>

        {/* Plan Usage Banner — shown only for limited plans */}
        {showUsageBanner && (
          <Card className={`border ${(buildsNearLimit || projectsNearLimit) ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-border/40 bg-secondary/20'}`}>
            <CardContent className="p-5">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    {(buildsNearLimit || projectsNearLimit) && <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />}
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                      Plan Usage · <span className="text-primary font-bold capitalize">{user?.plan} Plan</span>
                      {planLimits.deployments === 0 && <span className="ml-2 text-yellow-400">· No Deployments</span>}
                    </p>
                  </div>
                  {/* Builds bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-mono text-muted-foreground">
                      <span>Builds this month</span>
                      <span className={buildsNearLimit ? 'text-yellow-400 font-bold' : ''}>
                        {buildsUsed} / {buildsLimit > 0 ? buildsLimit : '∞'}
                      </span>
                    </div>
                    {buildsLimit > 0 && (
                      <div className="w-full bg-secondary rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${buildsUsed >= buildsLimit ? 'bg-red-500' : buildsNearLimit ? 'bg-yellow-400' : 'bg-primary'}`}
                          style={{ width: `${Math.min(100, (buildsUsed / buildsLimit) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {/* Projects bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-mono text-muted-foreground">
                      <span>Projects</span>
                      <span className={projectsNearLimit ? 'text-yellow-400 font-bold' : ''}>
                        {projectsUsed} / {projectsLimit > 0 ? projectsLimit : '∞'}
                      </span>
                    </div>
                    {projectsLimit > 0 && (
                      <div className="w-full bg-secondary rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${projectsUsed >= projectsLimit ? 'bg-red-500' : projectsNearLimit ? 'bg-yellow-400' : 'bg-primary'}`}
                          style={{ width: `${Math.min(100, (projectsUsed / projectsLimit) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <Button asChild size="sm" className="glow-primary-hover">
                    <Link href="/pricing"><Zap className="w-3.5 h-3.5 mr-1.5" />Upgrade Plan</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Projects Grid */}
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold flex items-center">
            <span className="w-3 h-3 bg-primary mr-2 cyber-clip"></span>
            ACTIVE CONSTRUCTS
          </h2>
          
          {projectsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1,2,3].map(i => <Card key={i} className="h-48 animate-pulse bg-secondary/50" />)}
            </div>
          ) : projects?.length === 0 ? (
            <Card className="p-12 text-center flex flex-col items-center justify-center border-dashed border-2">
              <Terminal className="w-12 h-12 text-muted-foreground mb-4" />
              <CardTitle className="mb-2 text-muted-foreground">No Constructs Found</CardTitle>
              <p className="text-sm font-mono text-muted-foreground mb-6">Initialize a new project to engage the agent swarm.</p>
              <Button variant="outline" asChild><Link href="/projects/new">Initialize</Link></Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects?.map(project => (
                <Card
                  key={project.id}
                  className="group hover:border-primary/50 transition-colors flex flex-col cursor-pointer select-none"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <CardHeader className="pb-3 border-b border-border/30">
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-lg truncate pr-2 group-hover:text-glow transition-all">{project.name}</CardTitle>
                      <Badge variant={getStatusColor(project.status) as any}>
                        {project.status === 'building' && <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping mr-1.5 inline-block" />}
                        {project.status}
                      </Badge>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground pt-1">TYPE: {project.type.toUpperCase()}</p>
                  </CardHeader>
                  <CardContent className="pt-4 flex-1 flex flex-col justify-between">
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-4 font-mono">
                      {project.prompt || "No prompt provided."}
                    </p>
                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-xs font-mono text-muted-foreground opacity-50">
                        {format(new Date(project.createdAt), 'MMM dd, HH:mm')}
                      </span>
                      <span className="text-xs font-mono text-primary group-hover:opacity-100 opacity-50 transition-opacity">OPEN →</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  return (
    <Card className="bg-secondary/20">
      <CardContent className="p-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-mono text-muted-foreground mb-1">{title}</p>
          <p className={`text-2xl font-display font-bold ${color}`}>{value}</p>
        </div>
        <div className={`p-3 bg-background border border-border cyber-clip ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </CardContent>
    </Card>
  );
}
