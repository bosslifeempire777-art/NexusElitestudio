import { Link } from "wouter";
import { Button } from "@/components/ui/cyber-ui";
import { Terminal, Cpu, Rocket, Code, Gamepad2, Shield } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";

export default function Home() {
  const { data: user } = useGetMe({ query: { retry: false }});

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Hero Background */}
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
          alt="Cyberpunk cityscape" 
          className="w-full h-full object-cover opacity-20 object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/90 to-background"></div>
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 lg:px-12 py-6">
        <div className="flex items-center space-x-3">
          <Terminal className="w-8 h-8 text-primary" />
          <span className="font-display font-bold text-2xl tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
            NEXUS STUDIO
          </span>
        </div>
        <div className="space-x-4">
          <Button variant="ghost" asChild>
            <Link href="/marketplace">Marketplace</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/pricing">Pricing</Link>
          </Button>
          {user ? (
            <Button variant="default" asChild>
              <Link href="/dashboard">Enter Terminal</Link>
            </Button>
          ) : (
            <Button variant="default" asChild>
              <Link href="/dashboard">Initialize</Link>
            </Button>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 container mx-auto px-6 pt-20 pb-32 flex flex-col items-center text-center">
        <div className="inline-flex items-center space-x-2 border border-primary/30 bg-primary/5 px-4 py-1.5 rounded-full mb-8 cyber-clip">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
          <span className="text-xs font-mono text-primary uppercase tracking-wider">v2.4.0 Autonomous Protocols Online</span>
        </div>
        
        <h1 className="text-5xl md:text-7xl font-display font-black tracking-tight mb-6 max-w-4xl text-glow">
          BUILD THE FUTURE WITH <br/>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary animate-pulse">AUTONOMOUS AGENTS</span>
        </h1>
        
        <p className="text-xl text-muted-foreground mb-10 max-w-2xl font-mono leading-relaxed">
          Describe your vision. Our swarm of specialized AI agents will architect, code, design, and deploy your software, SaaS, or game in minutes.
        </p>

        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-6 w-full max-w-md justify-center">
          <Button size="lg" className="w-full sm:w-auto text-lg glow-primary-hover" asChild>
            <Link href="/projects/new">Start Building <Rocket className="ml-2 w-5 h-5" /></Link>
          </Button>
          <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg" asChild>
            <Link href="/agents">View Agent Swarm <Cpu className="ml-2 w-5 h-5" /></Link>
          </Button>
        </div>
      </main>

      {/* Features Grid */}
      <section className="relative z-10 bg-secondary/50 border-t border-border/50 py-24">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={Code}
              title="Full-Stack Generation"
              desc="From database schemas to responsive React frontends. Complete production-ready repositories."
            />
            <FeatureCard 
              icon={Gamepad2}
              title="Game Studio"
              desc="Generate game mechanics, 3D/2D assets, and multiplayer logic for Unity, Unreal, and Godot."
            />
            <FeatureCard 
              icon={Shield}
              title="DevOps & Security"
              desc="Automated CI/CD pipelines, security audits, and instant deployment to cloud infrastructure."
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }: { icon: any, title: string, desc: string }) {
  return (
    <div className="glass-panel p-8 cyber-clip border-l-4 border-l-primary hover:border-l-accent transition-colors group">
      <Icon className="w-12 h-12 text-primary mb-6 group-hover:text-accent transition-colors" />
      <h3 className="text-xl font-display font-bold mb-3">{title}</h3>
      <p className="text-muted-foreground font-mono text-sm leading-relaxed">{desc}</p>
    </div>
  );
}
