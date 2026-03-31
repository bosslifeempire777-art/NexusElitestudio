import * as React from "react";
import { useState } from "react";
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
  PanelLeftClose,
  PanelLeftOpen,
  Crown,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects/new", label: "Project Builder", icon: Code2 },
  { href: "/agents", label: "Agent Swarm", icon: Bot },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/pricing", label: "Plans & Pricing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem("nexus-sidebar") !== "closed"; } catch { return true; }
  });

  const toggleSidebar = () => {
    setSidebarOpen(prev => {
      const next = !prev;
      try { localStorage.setItem("nexus-sidebar", next ? "open" : "closed"); } catch {}
      return next;
    });
  };

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const isAdmin = user?.isAdmin === true;
  const isVip = user?.isVip === true;
  const planLabel = user?.isAdmin ? "ADMIN" : user?.isVip ? "VIP" : (user?.plan?.toUpperCase() ?? "FREE");
  const planColor = user?.isAdmin ? "text-destructive" : user?.isVip ? "text-yellow-400" : "text-primary";

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden relative">
      {/* Background Grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />

      {/* Sidebar */}
      <aside
        className={cn(
          "shrink-0 border-r border-border/50 bg-card/80 backdrop-blur-xl flex flex-col z-20 relative transition-all duration-300 ease-in-out overflow-hidden",
          sidebarOpen ? "w-64" : "w-0 border-r-0",
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center border-b border-border/50 overflow-hidden">
          <img
            src={`${import.meta.env.BASE_URL}images/nexuselite-logo.png`}
            alt="NexusElite AI Studio"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>

        {/* Nav */}
        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto whitespace-nowrap">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2.5 text-sm font-medium transition-all group cyber-clip relative",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/30 glow-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent",
                )}
              >
                <item.icon className={cn("w-5 h-5 mr-3 shrink-0 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                {item.label}
                {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
              </Link>
            );
          })}

          {/* VIP badge in nav */}
          {(isVip || isAdmin) && (
            <div className="mt-4 mb-1 px-3 flex items-center gap-2 text-xs font-mono text-yellow-400/70">
              <Crown className="w-3 h-3" />
              <span>{isAdmin ? "ADMIN ACCESS" : "VIP ACCESS"} — UNLIMITED</span>
            </div>
          )}

          {/* Admin-only: Admin Console */}
          {isAdmin && (
            <>
              <div className="mt-4 mb-2 px-3 text-xs font-display tracking-widest text-muted-foreground uppercase">System</div>
              <Link
                href="/admin"
                className={cn(
                  "flex items-center px-3 py-2.5 text-sm font-medium transition-all group cyber-clip relative",
                  location.startsWith("/admin")
                    ? "bg-destructive/10 text-destructive border border-destructive/30"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent",
                )}
              >
                <ShieldAlert className={cn("w-5 h-5 mr-3 shrink-0", location.startsWith("/admin") ? "text-destructive" : "group-hover:text-foreground")} />
                Admin Console
                {location.startsWith("/admin") && <div className="absolute left-0 top-0 bottom-0 w-1 bg-destructive" />}
              </Link>
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="p-4 border-t border-border/50 whitespace-nowrap">
          <div className="flex items-center p-3 bg-secondary/30 rounded cyber-clip border border-border/50">
            <div className={cn(
              "w-8 h-8 rounded flex items-center justify-center font-display font-bold border shrink-0 text-sm",
              isAdmin ? "bg-destructive/20 text-destructive border-destructive/30" :
              isVip ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
              "bg-primary/20 text-primary border-primary/30"
            )}>
              {user?.username?.[0]?.toUpperCase() || "?"}
            </div>
            <div className="ml-3 flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{user?.username || "—"}</p>
              <p className={cn("text-xs font-mono", planColor)}>{planLabel} TIER</p>
            </div>
            <button
              onClick={handleLogout}
              title="Log out"
              className="text-muted-foreground hover:text-destructive transition-colors ml-2 shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden z-10 relative">
        <header className="h-16 border-b border-border/50 bg-background/50 backdrop-blur-md flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3 text-sm font-mono text-muted-foreground min-w-0">
            <button
              onClick={toggleSidebar}
              title={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
              className="p-1.5 rounded hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {sidebarOpen
                ? <PanelLeftClose className="w-4 h-4" />
                : <PanelLeftOpen  className="w-4 h-4" />}
            </button>
            <span className="text-primary shrink-0">{">"}</span>
            <span className="truncate">{location === "/" ? "/home" : location}</span>
          </div>
          <div className="flex items-center space-x-4 shrink-0">
            {isAdmin && (
              <span className="text-xs font-mono text-destructive border border-destructive/30 px-2 py-0.5 rounded hidden sm:inline">
                ADMIN
              </span>
            )}
            {isVip && !isAdmin && (
              <span className="text-xs font-mono text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded hidden sm:inline">
                VIP
              </span>
            )}
            <div className="flex items-center space-x-2 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-muted-foreground hidden sm:inline">SYSTEM_ONLINE</span>
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
