import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, Button, Input, Textarea, Badge } from "@/components/ui/cyber-ui";
import { useCreateProject, CreateProjectRequestType } from "@workspace/api-client-react";
import { Bot, Code2, Smartphone, Cloud, Cpu, Gamepad2, Settings2, PlaySquare, Zap } from "lucide-react";
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

export default function NewProject() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createMutation = useCreateProject();
  
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<CreateProjectRequestType>('saas');
  const [engine, setEngine] = useState("arcade");

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
      { data: { name, prompt: finalPrompt, type } },
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

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto py-8">
        <div className="mb-8 border-b border-border/50 pb-6">
          <h1 className="text-3xl font-display font-bold flex items-center text-glow">
            <Settings2 className="mr-3 text-primary" /> NEW CONSTRUCT
          </h1>
          <p className="text-muted-foreground font-mono mt-2">Define parameters and engage the agent swarm.</p>
          <div className="mt-4 flex items-center gap-2 border border-primary/20 bg-primary/5 rounded px-4 py-2.5 text-xs font-mono text-primary/80 w-fit">
            <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>
              <span className="text-primary font-bold">659+ AI models</span> available — the swarm automatically selects the best model for each step of your build, keeping costs low and quality high.
            </span>
          </div>
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

          <div className="flex justify-end space-x-4">
            <Button variant="ghost" type="button" onClick={() => setLocation('/dashboard')}>Abort</Button>
            <Button 
              type="submit" 
              size="lg" 
              className="glow-primary-hover min-w-[200px]"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>Initializing Swarm... <span className="w-4 h-4 ml-2 border-2 border-background border-t-transparent rounded-full animate-spin"></span></>
              ) : (
                <>ENGAGE BUILD <PlaySquare className="ml-2 w-5 h-5" /></>
              )}
            </Button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
