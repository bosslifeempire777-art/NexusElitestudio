import * as React from "react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/components/ui/cyber-ui";
import { PromoBanner } from "@/components/ui/PromoBanner";
import { 
  LayoutDashboard, 
  Code2, 
  Bot, 
  Store, 
  Settings, 
  ShieldAlert,
  CreditCard,
  LogOut,
  Menu,
  X,
  Crown,
  Sword,
  Gift,
  Globe,
  Activity,
  Beaker,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const navItems = [
  { href: "/dashboard",    label: "Dashboard",       icon: LayoutDashboard },
  { href: "/projects/new", label: "Project Builder", icon: Code2 },
  { href: "/characters",   label: "Character Studio", icon: Sword },
  { href: "/agents",       label: "Agent Swarm",      icon: Bot },
  { href: "/marketplace",  label: "Marketplace",      icon: Store },
  { href: "/deployments",  label: "Deployments",      icon: Globe },
  { href: "/ai-lab",       label: "AI Lab",           icon: Beaker },
  { href: "/usage",        label: "Usage & Billing",  icon: Activity },
  { href: "/pricing",      label: "Plans & Pricing",  icon: CreditCard },
  { href: "/refer",        label: "Refer & Earn",     icon: Gift },
  { href: "/settings",     label: "Settings",         icon: Settings },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) return false;
    try { return localStorage.getItem("nexus-sidebar") !== "closed"; } catch { return true; }
  });

  // Close sidebar automatically when switching to mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const openSidebar  = () => setSidebarOpen(true);
  const closeSidebar = () => setSidebarOpen(false);

  const toggleSidebar = () => {
    setSidebarOpen(prev => {
      const next = !prev;
      if (!isMobile) {
        try { localStorage.setItem("nexus-sidebar", next ? "open" : "closed"); } catch {}
      }
      return next;
    });
  };

  function handleNavClick() {
    if (isMobile) closeSidebar();
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const isAdmin  = user?.isAdmin === true;
  const isVip    = user?.isVip   === true;
  const planLabel = user?.isAdmin ? "ADMIN" : user?.isVip ? "VIP" : (user?.plan?.toUpperCase() ?? "FREE");
  const planColor = user?.isAdmin ? "text-destructive" : user?.isVip ? "text-yellow-400" : "text-primary";

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden relative">
      <PromoBanner />
    <div className="flex flex-1 overflow-hidden relative">
      {/* Background Grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />

      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col bg-card/95 backdrop-blur-xl border-r border-border/50 z-40 transition-all duration-300 ease-in-out",
          // Mobile: fixed overlay drawer
          isMobile
            ? cn(
                "fixed inset-y-0 left-0 w-72",
                sidebarOpen ? "translate-x-0 shadow-2xl shadow-black/50" : "-translate-x-full",
              )
            // Desktop: inline sidebar that collapses
            : cn(
                "relative shrink-0 overflow-hidden",
                sidebarOpen ? "w-64" : "w-0 border-r-0",
              ),
        )}
      >
        {/* Mobile close button */}
        {isMobile && (
          <button
            onClick={closeSidebar}
            className="absolute top-3 right-3 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Logo */}
        <div className="flex flex-col items-center justify-center py-6 px-4 border-b border-border/50">
          <img
            src={`${import.meta.env.BASE_URL}images/nexuselite-logo.png`}
            alt="NexusElite AI Studio"
            className="w-full max-w-[180px] h-auto object-contain drop-shadow-[0_0_18px_rgba(0,212,255,0.45)]"
          />
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto whitespace-nowrap">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
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

          {(isVip || isAdmin) && (
            <div className="mt-4 mb-1 px-3 flex items-center gap-2 text-xs font-mono text-yellow-400/70">
              <Crown className="w-3 h-3" />
              <span>{isAdmin ? "ADMIN ACCESS" : "VIP ACCESS"} — UNLIMITED</span>
            </div>
          )}

          {isAdmin && (
            <>
              <div className="mt-4 mb-2 px-3 text-xs font-display tracking-widest text-muted-foreground uppercase">System</div>
              <Link
                href="/admin"
                onClick={handleNavClick}
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
              isVip   ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
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
        <header className="h-14 md:h-16 border-b border-border/50 bg-background/50 backdrop-blur-md flex items-center justify-between px-3 md:px-4 shrink-0">
          <div className="flex items-center gap-2 md:gap-3 text-sm font-mono text-muted-foreground min-w-0">
            <button
              onClick={toggleSidebar}
              title={sidebarOpen ? "Close menu" : "Open menu"}
              className="p-2 rounded hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-primary shrink-0 hidden sm:inline">{">"}</span>
            <span className="truncate text-xs md:text-sm">{location === "/" ? "/home" : location}</span>
          </div>
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
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
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-muted-foreground hidden sm:inline">ONLINE</span>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-6 scroll-smooth">
          {children}
        </div>
      </main>
    </div>
    </div>
  );
}
