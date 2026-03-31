import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";

// Pages
import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Dashboard from "@/pages/dashboard";
import NewProject from "@/pages/new-project";
import ProjectDetail from "@/pages/project-detail";
import Agents from "@/pages/agents";
import Marketplace from "@/pages/marketplace";
import Admin from "@/pages/admin";
import Settings from "@/pages/settings";
import Pricing from "@/pages/pricing";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="text-primary font-mono animate-pulse">LOADING...</div></div>;
  if (!user) return <Redirect to="/login" />;
  return <Component />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="text-primary font-mono animate-pulse">LOADING...</div></div>;
  if (!user) return <Redirect to="/login" />;
  if (!user.isAdmin) return <Redirect to="/dashboard" />;
  return <Component />;
}

function GuestRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Redirect to="/dashboard" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login">
        <GuestRoute component={Login} />
      </Route>
      <Route path="/register">
        <GuestRoute component={Register} />
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute component={Dashboard} />
      </Route>
      <Route path="/projects/new">
        <ProtectedRoute component={NewProject} />
      </Route>
      <Route path="/projects/:id">
        <ProtectedRoute component={ProjectDetail} />
      </Route>
      <Route path="/agents">
        <ProtectedRoute component={Agents} />
      </Route>
      <Route path="/marketplace">
        <ProtectedRoute component={Marketplace} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={Settings} />
      </Route>
      <Route path="/pricing" component={Pricing} />
      <Route path="/admin">
        <AdminRoute component={Admin} />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
