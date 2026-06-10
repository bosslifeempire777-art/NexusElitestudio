import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, Button, Input, Textarea, Badge } from "@/components/ui/cyber-ui";
import { useCreateProject, CreateProjectRequestType } from "@workspace/api-client-react";
import { Bot, Code2, Smartphone, Cloud, Cpu, Gamepad2, Settings2, PlaySquare, Zap,
         Sparkles, DollarSign, Crown, Shield, Layers, GitFork } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const projectTypes = [
  { id: 'saas', label: 'SaaS Platform', icon: Cloud, desc: 'Full-stack web application with auth & db' },
  { id: 'website', label: 'Web Application', icon: Code2, desc: 'Modern frontend with complex UI' },
  { id: 'mobile_app', label: 'Mobile App', icon: Smartphone, desc: 'Cross-platform mobile application' },
  { id: 'game', label: 'Video Game', icon: Gamepad2, desc: '2D/3D game with physics & logic' },
  { id: 'ai_tool', label: 'AI Tool', icon: Bot, desc: 'Tool leveraging LLMs or custom models' },
  { id: 'automation', label: 'Automation', icon: Cpu, desc: 'Background workers & data pipelines' },
];

export const SWARM_MODES = [
  {
    id: 'genesis',
    label: 'Genesis',
    icon: Sparkles,
    color: 'text-primary',
    accent: 'border-primary bg-primary/10',
    badge: 'RECOMMENDED',
    desc: 'Full 5-layer auto-pilot. Concierge picks cost vs premium based on your prompt.',
    models: 'Gemini Flash → DeepSeek / Claude Sonnet 4',
  },
  {
    id: 'cost',
    label: 'Cost Swarm',
    icon: DollarSign,
    color: 'text-green-400',
    accent: 'border-green-500/60 bg-green-500/5',
    badge: 'BUDGET',
    desc: 'DeepSeek-first pipeline. Full swarm, fraction of the cost.',
    models: 'DeepSeek Chat → Qwen Coder → Llama 3.3 70B',
  },
  {
    id: 'premium',
    label: 'Premium Swarm',
    icon: Crown,
    color: 'text-yellow-400',
    accent: 'border-yellow-500/60 bg-yellow-500/5',
    badge: 'MAX QUALITY',
    desc: 'Claude Sonnet 4 + GPT-4o throughout. Two Guardian review passes.',
    models: 'Claude Sonnet 4 → GPT-4o → Gemini 2.5 Pro',
  },
  {
    id: 'guardian',
    label: 'Guardian',
    icon: Shield,
    color: 'text-blue-400',
    accent: 'border-blue-500/60 bg-blue-500/5',
    badge: 'REVIEW',
    desc: 'Adversarial review & repair pass. Best for bug-fixing existing apps.',
    models: 'GPT-4o (review) → Claude Sonnet 4 (repair)',
  },
  {
    id: 'concierge',
    label: 'Concierge',
    icon: Zap,
    color: 'text-cyan-400',
    accent: 'border-cyan-500/60 bg-cyan-500/5',
    badge: 'FAST',
    desc: 'Single fast model — no swarm spawn. Ideal for quick edits & small tasks.',
    models: 'Gemini 2.5 Flash only',
  },
  {
    id: 'hydra',
    label: 'Hydra',
    icon: GitFork,
    color: 'text-purple-400',
    accent: 'border-purple-500/60 bg-purple-500/5',
    badge: 'PARALLEL',
    desc: 'Legacy parallel 3-tier execution. All models fire simultaneously.',
    models: 'DeepSeek + Claude + GPT-4o in parallel',
  },
] as const;

export type SwarmModeId = typeof SWARM_MODES[number]['id'];

export default function NewProject() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createMutation = useCreateProject();
  
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<CreateProjectRequestType>('saas');
  const [engine, setEngine] = useState("arcade");
  const [swarmMode, setSwarmMode] = useState<SwarmModeId>("genesis");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !prompt) {
      toast({ title: "Validation Error", description: "Name and prompt are required", variant: "destructive" });
      return;
    }

    const finalPrompt = type === 'game' && engine
      ? `[Game Genre: ${engine}] ${prompt}`
      : prompt;

    createMutation.mutate(
      { data: { name, prompt: finalPrompt, type, swarm_mode: swarmMode } as any },
      {
        onSuccess: (data) => {
          toast({ title: "Construct Initialized", description: "Agents are deploying..." });
          setLocation(`/projects/${data.id}`);
        },
        onError: (err: any) => {
          if (err?.status === 402) {
            const apiMessage = (err?.data as any)?.message || "Upgrade your plan to create more projects.";
            toast({
              title: "Plan Limit Reached",
              description: (
                <span>
                  {apiMessage}{" "}
                  <Link href="/pricing" className="underline font-bold text-primary">View Plans →</Link>
                </span>
              ) as any,
              variant: "destructive",
            });
          } else {
            toast({ title: "Initialization Failed", description: err.message || "Unknown error", variant: "destructive" });
          }
        }
      }
    );
  };

  const activeSwarm = SWARM_MODES.find(s => s.id === swarmMode)!;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto py-8">
        <div className="mb-8 border-b border-border/50 pb-6">
          <h1 className="text-3xl font-display font-bold flex items-center text-glow">
            <Settings2 className="mr-3 text-primary" /> NEW CONSTRUCT
          </h1>
          <p className="text-muted-foreground font-mono mt-2">Define parameters and engage the agent swarm.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <Card className="p-6 border-primary/20">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono text-primary mb-2 block uppercase tracking-widest">Construct Name</label>
                <Input 
                  placeholder="e.g. Nexus Dashboard v2" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-lg py-6"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-primary mb-2 mt-6 block uppercase tracking-widest">Select Archetype</label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {projectTypes.map(pt => (
                    <div 
                      key={pt.id}
                      onClick={() => setType(pt.id as CreateProjectRequestType)}
                      className={`cursor-pointer border p-4 transition-all cyber-clip relative group ${
                        type === pt.id 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border bg-secondary/30 hover:border-primary/50'
                      }`}
                    >
                      <pt.icon className={`w-6 h-6 mb-3 ${type === pt.id ? 'text-primary glow-primary' : 'text-muted-foreground'}`} />
                      <h4 className={`font-display font-semibold mb-1 ${type === pt.id ? 'text-primary' : 'text-foreground'}`}>{pt.label}</h4>
                      <p className="text-xs font-mono text-muted-foreground">{pt.desc}</p>
                      {type === pt.id && <div className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full animate-pulse" />}
                    </div>
                  ))}
                </div>
              </div>

              {type === 'game' && (
                <div className="pt-4 animate-in fade-in slide-in-from-top-4">
                  <label className="text-xs font-mono text-accent mb-2 block uppercase tracking-widest">Game Genre</label>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { id: 'arcade', label: '🕹️ Arcade', desc: 'Shoot \'em up, dodger, classic action' },
                      { id: 'platformer', label: '🏃 Platformer', desc: 'Side-scroll, jump & run' },
                      { id: 'puzzle', label: '🧩 Puzzle', desc: 'Match-3, logic, brain teaser' },
                      { id: 'rpg', label: '⚔️ RPG', desc: 'Stats, inventory, exploration' },
                      { id: 'strategy', label: '🗺️ Strategy', desc: 'Tower defense, resource mgmt' },
                    ].map(g => (
                      <Badge
                        key={g.id}
                        variant={engine === g.id ? 'default' : 'outline'}
                        className="cursor-pointer px-4 py-2 text-sm flex flex-col items-start h-auto"
                        onClick={() => setEngine(g.id)}
                        title={g.desc}
                      >
                        {g.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-2">Games run in the browser using HTML5 Canvas — fully playable in the preview.</p>
                </div>
              )}

              <div>
                <label className="text-xs font-mono text-primary mb-2 mt-6 block uppercase tracking-widest">System Prompt (Natural Language)</label>
                <Textarea 
                  placeholder="Describe the application in detail. What features does it need? Who are the users? What is the design style?" 
                  className="min-h-[200px] text-base leading-relaxed p-4"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            </div>
          </Card>

          {/* ── Swarm Mode Selector ── */}
          <div>
            <div className="mb-3">
              <label className="text-xs font-mono text-primary uppercase tracking-widest">Select Swarm Mode</label>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                Only one swarm is active at a time. Current: <span className={`font-bold ${activeSwarm.color}`}>{activeSwarm.label}</span>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {SWARM_MODES.map(mode => {
                const Icon = mode.icon;
                const isActive = swarmMode === mode.id;
                return (
                  <div
                    key={mode.id}
                    onClick={() => setSwarmMode(mode.id)}
                    className={`cursor-pointer border rounded-lg p-4 transition-all relative ${
                      isActive ? mode.accent + ' ring-1 ring-current' : 'border-border/50 bg-secondary/20 hover:border-border'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`w-4 h-4 ${isActive ? mode.color : 'text-muted-foreground'}`} />
                      <span className={`text-sm font-bold ${isActive ? mode.color : 'text-foreground'}`}>{mode.label}</span>
                      <span className="ml-auto text-[9px] font-mono text-muted-foreground/70 border border-border/40 rounded px-1 py-0.5">{mode.badge}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{mode.desc}</p>
                    <p className="text-[10px] font-mono text-muted-foreground/60 mt-1.5 truncate">{mode.models}</p>
                    {isActive && (
                      <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-current animate-pulse" style={{ color: 'inherit' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end space-x-4">
            <Button variant="ghost" type="button" onClick={() => setLocation('/dashboard')}>Abort</Button>
            <Button 
              type="submit" 
              size="lg" 
              className="glow-primary-hover min-w-[200px]"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>Initializing {activeSwarm.label} Swarm... <span className="w-4 h-4 ml-2 border-2 border-background border-t-transparent rounded-full animate-spin"></span></>
              ) : (
                <>ENGAGE {activeSwarm.label.toUpperCase()} <PlaySquare className="ml-2 w-5 h-5" /></>
              )}
            </Button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
