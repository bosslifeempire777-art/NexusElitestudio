import { Link } from "wouter";
import { Button } from "@/components/ui/cyber-ui";
import { Cpu, Rocket, Code, Shield, BrainCircuit, Zap, TrendingDown, Layers, Beaker, Sparkles, Trophy, Coins } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { HomeDemoPlayer } from "@/components/ui/HomeDemoPlayer";
import { PromoBanner } from "@/components/ui/PromoBanner";

export default function Home() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <PromoBanner />
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
            src={`${import.meta.env.BASE_URL}images/nexuselite-logo.png`}
            alt="NexusElite AI Studio"
            style={{ height: '72px', width: 'auto' }}
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
          Describe your vision. Our swarm of 21 specialized AI agents will architect, code, design, and deploy your software, SaaS, or game faster, easier, and better than you ever imagined possible.
        </p>
        <p className="text-base text-primary/70 mb-4 max-w-xl font-mono leading-relaxed">
          Powered by <span className="text-primary font-bold">659+ AI models</span> — including <span className="text-primary font-bold">Claude Opus 4.7</span>, <span className="text-primary font-bold">GPT-5.4 Pro</span>, <span className="text-primary font-bold">Kimi 2.6</span>, and every other top model the moment it ships, always kept up to date — the swarm picks the perfect model for every task automatically, cutting your costs without cutting corners.
        </p>
        <p className="text-base text-accent/80 mb-10 max-w-xl font-mono leading-relaxed">
          On any paid plan, choose your <span className="text-accent font-bold">swarm mode</span> — pure cost-optimized, balanced, or <span className="text-accent font-bold">all top-tier models</span> capable of anything and always at their best. Multiple modes, one switch, you decide.
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

      {/* Live Demo + Try It Free */}
      <HomeDemoPlayer />

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

      {/* AI Lab — NEW Feature Spotlight */}
      <section className="relative z-10 py-24 border-t border-border/50">
        <div className="container mx-auto px-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="px-2.5 py-1 text-[10px] font-mono bg-accent text-background rounded uppercase tracking-wider font-bold">New</span>
              <span className="text-xs font-mono text-accent uppercase tracking-widest">AI Lab — Test Drive</span>
            </div>
            <h2 className="text-center text-3xl md:text-4xl font-display font-bold mb-4 text-glow uppercase">
              Try Every Top Model. <span className="text-accent">Side-by-Side.</span>
            </h2>
            <p className="text-center text-muted-foreground font-mono text-sm md:text-base mb-12 max-w-2xl mx-auto">
              The only platform that lets you race GPT-4o, Claude 3.5 Sonnet, Gemini, Llama, Mistral and DeepSeek against the same prompt — then graduate to your winner with one click.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              <div className="glass-panel p-6 cyber-clip border-l-4 border-l-accent">
                <Beaker className="w-10 h-10 text-accent mb-4" />
                <h3 className="text-lg font-display font-bold mb-2">Pay Per Prompt</h3>
                <p className="text-muted-foreground font-mono text-xs leading-relaxed">Start at <span className="text-accent font-bold">$5 for 100 prompts</span>. No subscription. Test as little or as much as you need.</p>
              </div>
              <div className="glass-panel p-6 cyber-clip border-l-4 border-l-accent">
                <Sparkles className="w-10 h-10 text-accent mb-4" />
                <h3 className="text-lg font-display font-bold mb-2">3-Way Compare</h3>
                <p className="text-muted-foreground font-mono text-xs leading-relaxed">Run the same prompt across the top 3 models for your app type. See the differences instantly. Pick the winner.</p>
              </div>
              <div className="glass-panel p-6 cyber-clip border-l-4 border-l-accent">
                <Trophy className="w-10 h-10 text-accent mb-4" />
                <h3 className="text-lg font-display font-bold mb-2">Graduate Direct</h3>
                <p className="text-muted-foreground font-mono text-xs leading-relaxed">Found your model? We hand you the sign-up link to OpenAI, Anthropic, Google or OpenRouter — your account, your bill, no markup.</p>
              </div>
            </div>

            <div className="text-center">
              <Button size="lg" variant="outline" className="text-base" asChild>
                <Link href="/ai-lab">Open the AI Lab <Beaker className="ml-2 w-4 h-4" /></Link>
              </Button>
              <p className="text-[11px] font-mono text-muted-foreground mt-4">
                <Coins className="inline w-3 h-3 text-yellow-400 mr-1" />
                Available on every plan — including Free.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What Makes Us One-of-a-Kind */}
      <section className="relative z-10 py-24 border-t border-border/50 bg-secondary/30">
        <div className="container mx-auto px-6">
          <h2 className="text-center text-3xl md:text-4xl font-display font-bold mb-4 text-glow uppercase">
            What Makes NexusElite <span className="text-accent">One of a Kind</span>
          </h2>
          <p className="text-center text-muted-foreground font-mono text-sm mb-12 max-w-2xl mx-auto">
            Five things you can do here that no other AI app builder offers.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <UniqueCard num="01" title="Persistent Project Memory" desc="Your AI remembers every decision, completed feature, and pending task across sessions. Pick up exactly where you left off — no re-explaining." />
            <UniqueCard num="02" title="21-Agent Coordinated Swarm" desc="Architect, designer, security auditor, game engine, DevOps — all working in parallel. Other tools use one model for everything." />
            <UniqueCard num="03" title="AI Lab Model Race" desc="Run the same prompt across 3 frontier models side-by-side. Find the perfect AI for your project before committing." />
            <UniqueCard num="04" title="Character Studio for Games" desc="Generate game-ready characters with stats, lore, and sprites. Drop them straight into your game project." />
            <UniqueCard num="05" title="One-Click Deploy to Live URL" desc="From idea to public URL in minutes. Render-backed deployments with custom domains, SSL, and CI/CD baked in." />
            <UniqueCard num="06" title="Marketplace + Refer & Earn" desc="Sell what you build. Earn from every friend you bring in. Your studio becomes a revenue stream, not just an expense." />
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

function UniqueCard({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div className="border border-border/50 bg-background/40 p-6 rounded-lg hover:border-accent transition-colors group">
      <div className="text-3xl font-display font-black text-accent/40 group-hover:text-accent mb-2 transition-colors">{num}</div>
      <h3 className="text-base font-display font-bold mb-2 text-foreground">{title}</h3>
      <p className="text-muted-foreground font-mono text-xs leading-relaxed">{desc}</p>
    </div>
  );
}
