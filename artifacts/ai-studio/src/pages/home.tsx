import { Link } from "wouter";
import { Button } from "@/components/ui/cyber-ui";
import { Cpu, Rocket, Code, Shield, BrainCircuit, Zap, TrendingDown, Layers } from "lucide-react";
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
        <div className="flex items-center">
          <img
            src={`${import.meta.env.BASE_URL}images/nexuselite-logo.jpg`}
            alt="NexusElite AI Studio"
            style={{ height: '48px', width: 'auto' }}
          />
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
          <span className="text-xs font-mono text-primary uppercase tracking-wider">659+ AI Models Online · Swarm Active</span>
        </div>
        
        <h1 className="text-5xl md:text-7xl font-display font-black tracking-tight mb-6 max-w-4xl text-glow">
          BUILD THE FUTURE WITH <br/>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary animate-pulse">AUTONOMOUS AGENTS</span>
        </h1>
        
        <p className="text-xl text-muted-foreground mb-4 max-w-2xl font-mono leading-relaxed">
          Describe your vision. Our swarm of 21 specialized AI agents will architect, code, design, and deploy your software, SaaS, or game in minutes.
        </p>
        <p className="text-base text-primary/70 mb-10 max-w-xl font-mono leading-relaxed">
          Powered by <span className="text-primary font-bold">659+ AI models</span> — including Claude Opus 4.5, GPT-4o, and every top model released — the swarm picks the perfect model for every task automatically, cutting your costs without cutting corners.
        </p>

        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-6 w-full max-w-md justify-center mb-16">
          <Button size="lg" className="w-full sm:w-auto text-lg glow-primary-hover" asChild>
            <Link href="/projects/new">Start Building <Rocket className="ml-2 w-5 h-5" /></Link>
          </Button>
          <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg" asChild>
            <Link href="/agents">View Agent Swarm <Cpu className="ml-2 w-5 h-5" /></Link>
          </Button>
        </div>

        {/* Stats Bar */}
        <div className="w-full max-w-3xl grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { value: "659+", label: "AI Models" },
            { value: "21", label: "Specialized Agents" },
            { value: "∞", label: "Model Updates" },
            { value: "↓ Cost", label: "Smart Routing Saves" },
          ].map(stat => (
            <div key={stat.label} className="border border-border/40 bg-secondary/30 rounded px-4 py-3 text-center">
              <div className="text-2xl font-display font-black text-primary">{stat.value}</div>
              <div className="text-xs font-mono text-muted-foreground mt-1 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </main>

      {/* Features Grid */}
      <section className="relative z-10 bg-secondary/50 border-t border-border/50 py-24">
        <div className="container mx-auto px-6">
          <h2 className="text-center text-3xl font-display font-bold mb-4 text-glow uppercase">Why There's Nothing Like It</h2>
          <p className="text-center text-muted-foreground font-mono text-sm mb-12 max-w-xl mx-auto">
            Nexus Studio is the only platform that combines a 21-agent swarm with intelligent access to over 659 AI models — always current, always optimal, always affordable.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={BrainCircuit}
              title="659+ AI Models — Always Current"
              desc="Connected to every top model the moment it's released. Claude Opus 4.5, GPT-4o, Gemini Ultra, Mistral, and hundreds more. You never fall behind — the swarm keeps pace with every frontier release automatically."
            />
            <FeatureCard 
              icon={Zap}
              title="Automatic Best-Model Routing"
              desc="No guessing which AI to use. The Orchestrator Agent analyzes each task and routes it to whichever of the 659+ models excels at it — fast models for quick tasks, powerful models for complex ones."
            />
            <FeatureCard 
              icon={TrendingDown}
              title="Saves You Money"
              desc="Smart routing means you only use expensive frontier models when genuinely needed. Lighter tasks hit smaller, cheaper models. Most platforms lock you into one expensive model for everything — we don't."
            />
            <FeatureCard 
              icon={Layers}
              title="21-Agent Swarm — Nothing Like It"
              desc="Not a single AI doing everything — a coordinated swarm of 21 specialists. Architect, Code Generator, UI/UX Designer, Security Auditor, Game Engine, DevOps, and more all working in parallel on your project."
            />
            <FeatureCard 
              icon={Code}
              title="Full-Stack Generation"
              desc="From database schemas to polished responsive frontends. Complete production-ready applications built and previewed in the browser in minutes, not months."
            />
            <FeatureCard 
              icon={Shield}
              title="DevOps, Security & Deploy"
              desc="Automated security audits, CI/CD configuration, and one-click deployment baked in. The DevOps Agent handles infrastructure so your team can stay focused on the product."
            />
          </div>
        </div>
      </section>

      {/* Model Highlight Banner */}
      <section className="relative z-10 py-16 border-t border-border/50">
        <div className="container mx-auto px-6 text-center">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">Models available in the swarm include</p>
          <div className="flex flex-wrap justify-center gap-3 max-w-3xl mx-auto">
            {[
              "Claude Opus 4.5", "Claude Sonnet 4", "GPT-4o", "GPT-4o Mini",
              "o1 Pro", "Gemini 1.5 Pro", "Gemini Flash", "Mistral Large",
              "DeepSeek R1", "Llama 3.3 70B", "Qwen 2.5", "+ 648 more"
            ].map(m => (
              <span key={m} className="border border-primary/20 bg-primary/5 text-primary font-mono text-xs px-3 py-1.5 rounded-full">
                {m}
              </span>
            ))}
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-6 max-w-md mx-auto">
            New models are added as they're released. Your projects automatically benefit from improvements — no action needed.
          </p>
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
