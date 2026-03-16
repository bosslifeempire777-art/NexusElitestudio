import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@/components/ui/cyber-ui";
import { useListProjects, useGetUserAnalytics } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus, Terminal, Activity, Zap, Database } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { data: analytics } = useGetUserAnalytics();

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
                <Card key={project.id} className="group hover:border-primary/50 transition-colors flex flex-col">
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
                      <Button variant="outline" size="sm" asChild className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/projects/${project.id}`}>ACCESS</Link>
                      </Button>
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
