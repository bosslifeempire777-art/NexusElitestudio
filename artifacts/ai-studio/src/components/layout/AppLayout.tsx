import * as React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/components/ui/cyber-ui";
import { 
  LayoutDashboard, 
  Code2, 
  Bot, 
  Store, 
  Settings, 
  ShieldAlert,
  CreditCard,
  LogOut,
  TerminalSquare
} from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects/new", label: "Project Builder", icon: Code2 },
  { href: "/agents", label: "Agent Swarm", icon: Bot },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/pricing", label: "Plans & Pricing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user } = useGetMe({ query: { retry: false }});
  
  // Show admin link if user is admin or for demo purposes
  const isAdmin = user?.isAdmin || true; // Force true for demo visibility

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden relative">
      {/* Background Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-5" 
           style={{ backgroundImage: 'linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)', backgroundSize: '50px 50px' }}>
      </div>

      {/* Sidebar */}
      <aside className="w-64 border-r border-border/50 bg-card/80 backdrop-blur-xl flex flex-col z-10 relative">
        <div className="h-16 flex items-center px-6 border-b border-border/50">
          <TerminalSquare className="w-6 h-6 text-primary mr-3" />
          <span className="font-display font-bold text-xl tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
            NEXUS
          </span>
        </div>
        
        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center px-3 py-2.5 text-sm font-medium transition-all group cyber-clip relative",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/30 glow-primary" 
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
              )}>
                <item.icon className={cn("w-5 h-5 mr-3 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                {item.label}
                {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <div className="mt-8 mb-2 px-3 text-xs font-display tracking-widest text-muted-foreground uppercase">System</div>
              <Link href="/admin" className={cn(
                "flex items-center px-3 py-2.5 text-sm font-medium transition-all group cyber-clip relative",
                location.startsWith("/admin") 
                  ? "bg-accent/10 text-accent border border-accent/30 glow-accent" 
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
              )}>
                <ShieldAlert className={cn("w-5 h-5 mr-3", location.startsWith("/admin") ? "text-accent" : "group-hover:text-foreground")} />
                Admin Console
              </Link>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-border/50">
          <div className="flex items-center p-3 bg-secondary/30 rounded cyber-clip border border-border/50">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center text-primary font-display font-bold border border-primary/30">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="ml-3 flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{user?.username || 'Guest_User'}</p>
              <p className="text-xs text-primary font-mono">{user?.plan?.toUpperCase() || 'FREE'} TIER</p>
            </div>
            <button className="text-muted-foreground hover:text-destructive transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden z-10 relative">
        <header className="h-16 border-b border-border/50 bg-background/50 backdrop-blur-md flex items-center justify-between px-6">
          <div className="flex items-center text-sm font-mono text-muted-foreground">
            <span className="text-primary mr-2">{'>'}</span> 
            {location === '/' ? '/home' : location}
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-muted-foreground">SYSTEM_ONLINE</span>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6 scroll-smooth">
          {children}
        </div>
      </main>
    </div>
  );
}
