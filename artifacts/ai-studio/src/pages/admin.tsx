import { AppLayout } from "@/components/layout/AppLayout";
import { useGetAnalyticsOverview, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui/cyber-ui";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Users, Database, DollarSign, Activity } from "lucide-react";

export default function Admin() {
  const { data: analytics, isLoading: analyticsLoading } = useGetAnalyticsOverview();
  const { data: users, isLoading: usersLoading } = useListUsers();

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-glow text-destructive">OVERSEER TERMINAL</h1>
          <p className="text-muted-foreground font-mono mt-1">Platform-wide telemetry and access control.</p>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatBox title="Total Users" value={analytics?.totalUsers || 0} icon={Users} color="text-primary" />
          <StatBox title="Constructs Built" value={analytics?.totalProjects || 0} icon={Database} color="text-accent" />
          <StatBox title="Active Agents" value={analytics?.activeAgents || 0} icon={Activity} color="text-green-400" />
          <StatBox title="MRR" value={`$${analytics?.totalRevenue || 0}`} icon={DollarSign} color="text-yellow-400" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-mono">BUILD VOLUME (30 DAYS)</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics?.buildsOverTime || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(t) => t.substring(5,10)} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    itemStyle={{ color: 'hsl(var(--primary))' }}
                  />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-border">
             <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-mono">REVENUE BY PLAN</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={Object.entries(analytics?.revenueByPlan || {}).map(([name, value]) => ({ name, value }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    cursor={{fill: 'hsl(var(--secondary))'}}
                  />
                  <Bar dataKey="value" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Users Table */}
        <Card>
          <CardHeader>
             <CardTitle className="text-muted-foreground text-sm font-mono">USER DIRECTORY</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono text-left">
                <thead className="text-xs text-muted-foreground uppercase border-b border-border/50">
                  <tr>
                    <th className="px-4 py-3">ID / Username</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Projects</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {users?.slice(0,10).map(user => (
                    <tr key={user.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground">{user.username}</div>
                        <div className="text-[10px] text-muted-foreground">{user.id.substring(0,8)}...</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={user.plan === 'vip' ? 'accent' : user.plan === 'enterprise' ? 'primary' : 'outline'} className="text-[10px]">
                          {user.plan}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-primary">{user.projectCount}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center">
                           <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2"></span> Active
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-xs text-muted-foreground hover:text-primary transition-colors uppercase tracking-wider">Inspect</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function StatBox({ title, value, icon: Icon, color }: any) {
  return (
    <div className="bg-secondary/20 border border-border/50 p-4 cyber-clip relative overflow-hidden group hover:border-primary/30 transition-colors">
      <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Icon className={`w-24 h-24 ${color}`} />
      </div>
      <p className="text-xs font-mono text-muted-foreground mb-1 relative z-10 uppercase tracking-widest">{title}</p>
      <p className={`text-3xl font-display font-bold ${color} relative z-10`}>{value}</p>
    </div>
  );
}
