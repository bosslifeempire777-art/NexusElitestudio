import { useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetProject, useGetProjectBuildLogs, useGetProjectFiles } from "@workspace/api-client-react";
import { Badge, Button } from "@/components/ui/cyber-ui";
import {
  Terminal, Folder, FileCode2, Play, ChevronRight, Loader2, StopCircle,
  ExternalLink, PanelRightClose, PanelRightOpen, Monitor, Tablet, Smartphone,
  RotateCcw, Send, Bot, User, Sparkles, Bug, Palette, FilePlus, Lock, Database,
  Zap, Moon, Layers, Globe, Cpu, RefreshCw, Rocket, Copy, Check, X,
} from "lucide-react";
import { getToken } from "@/lib/auth";
import { useState, useRef, useEffect, useCallback } from "react";
import { format } from "date-fns";

type Device = 'mobile' | 'tablet' | 'desktop';
type Tab = 'editor' | 'preview' | 'agent';

interface ChatMessage {
  role: "user" | "agent";
  content: string;
  timestamp: string;
}

const DEVICES: { id: Device; label: string; icon: typeof Monitor; width: number | null; height: number | null }[] = [
  { id: 'mobile',  label: 'Phone',   icon: Smartphone, width: 390,  height: 844  },
  { id: 'tablet',  label: 'Tablet',  icon: Tablet,     width: 768,  height: 1024 },
  { id: 'desktop', label: 'Desktop', icon: Monitor,    width: null, height: null  },
];

const QUICK_ACTIONS = [
  { label: "Add Feature",      icon: Sparkles, action: "Add Feature"      },
  { label: "Fix Bug",          icon: Bug,      action: "Fix Bug"          },
  { label: "Redesign UI",      icon: Palette,  action: "Redesign UI"      },
  { label: "Add Page",         icon: FilePlus, action: "Add Page"         },
  { label: "Add Auth",         icon: Lock,     action: "Add Authentication"},
  { label: "Add Database",     icon: Database, action: "Add Database"     },
  { label: "Optimize",         icon: Zap,      action: "Optimize Performance"},
  { label: "Dark Mode",        icon: Moon,     action: "Add Dark Mode"    },
  { label: "Mobile Layout",    icon: Smartphone,action:"Make Mobile Responsive"},
  { label: "Add API",          icon: Globe,    action: "Add API Endpoint" },
  { label: "Refactor Code",    icon: Layers,   action: "Refactor Code"    },
  { label: "AI Integration",   icon: Cpu,      action: "Add AI Integration"},
];

export default function ProjectDetail() {
  const { id } = useParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: project, isLoading, isError, error, refetch } = useGetProject(id || "", {
    query: {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'building' ? 2000 : false;
      },
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  });
  const { data: logs } = useGetProjectBuildLogs(id || "", {
    query: {
      refetchInterval: project?.status === 'building' ? 2000 : false,
    },
  });
  const { data: files } = useGetProjectFiles(id || "");

  const [activeTab, setActiveTab]       = useState<Tab>('preview');
  const [selectedFile, setSelectedFile] = useState<string | null>("index.html");
  const [logsOpen, setLogsOpen]         = useState(false);
  const [device, setDevice]             = useState<Device>('desktop');
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isDeploying, setIsDeploying]   = useState(false);
  const [deployedUrl, setDeployedUrl]   = useState<string | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [urlCopied, setUrlCopied]       = useState(false);

  function authHeaders(): Record<string, string> {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }

  const rebuild = useCallback(async () => {
    if (!id || isRebuilding) return;
    setIsRebuilding(true);
    try {
      await fetch(`/api/projects/${id}/rebuild`, { method: "POST", headers: authHeaders() });
    } finally {
      setIsRebuilding(false);
    }
  }, [id, isRebuilding]);

  const deploy = useCallback(async () => {
    if (!id || isDeploying) return;
    setIsDeploying(true);
    try {
      const res = await fetch(`/api/projects/${id}/deploy`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (res.ok && data.deployedUrl) {
        setDeployedUrl(data.deployedUrl);
        setShowDeployModal(true);
      }
    } catch {
      // no-op
    } finally {
      setIsDeploying(false);
    }
  }, [id, isDeploying]);

  const copyUrl = useCallback(() => {
    if (!deployedUrl) return;
    navigator.clipboard.writeText(deployedUrl).then(() => {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    });
  }, [deployedUrl]);

  if (isLoading) return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm font-mono text-muted-foreground">Loading construct…</p>
      </div>
    </AppLayout>
  );

  if (isError || (!project && !isLoading)) {
    const errMsg = (error as any)?.message ?? "Project not found or failed to load.";
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center">
            <span className="text-2xl">⚠</span>
          </div>
          <div>
            <h2 className="text-xl font-display font-bold text-destructive mb-2">CONSTRUCT UNAVAILABLE</h2>
            <p className="text-sm font-mono text-muted-foreground max-w-md">{errMsg}</p>
            <p className="text-xs font-mono text-muted-foreground mt-1">Project ID: {id}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-4 py-2 border border-primary/40 text-primary text-sm font-mono hover:bg-primary/10 transition-colors rounded"
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
            <a
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-2 border border-border/50 text-muted-foreground text-sm font-mono hover:text-foreground transition-colors rounded"
            >
              ← Back to Dashboard
            </a>
          </div>
        </div>
      </AppLayout>
    );
  }

  const previewUrl   = `/api/projects/${project.id}/preview`;
  const currentDevice = DEVICES.find(d => d.id === device)!;

  const refreshPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = previewUrl;
    }
  };

  // Derive the best code to show in the editor
  const editorCode = (() => {
    if (files && Array.isArray(files) && files.length > 0) {
      const found = (files as any[]).find((f: any) => f.path === selectedFile) || files[0];
      return (found as any)?.content || (project as any)?.generatedCode || MOCK_CODE;
    }
    return (project as any)?.generatedCode || MOCK_CODE;
  })();

  return (
    <AppLayout>
      {/* ── Deploy Success Modal ── */}
      {showDeployModal && deployedUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 bg-card border border-green-500/40 rounded-lg p-6 shadow-2xl cyber-clip">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Rocket className="w-5 h-5 text-green-400" />
                <h3 className="font-display font-bold text-lg text-green-400">DEPLOYED SUCCESSFULLY</h3>
              </div>
              <button onClick={() => setShowDeployModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground font-mono mb-4">
              Your app is live and accessible at this URL. Share it with anyone — no login required to view.
            </p>
            <div className="bg-background/60 border border-border/50 rounded flex items-center gap-2 p-3 mb-4">
              <a href={deployedUrl} target="_blank" rel="noreferrer" className="flex-1 text-primary text-sm font-mono truncate hover:underline">{deployedUrl}</a>
              <button onClick={copyUrl} className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
                {urlCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex gap-2">
              <a href={deployedUrl} target="_blank" rel="noreferrer" className="flex-1">
                <button className="w-full flex items-center justify-center gap-2 py-2 bg-green-500/20 border border-green-500/40 text-green-400 text-sm font-mono rounded hover:bg-green-500/30 transition-colors">
                  <ExternalLink className="w-4 h-4" /> Open Live App
                </button>
              </a>
              <button onClick={() => setShowDeployModal(false)} className="flex-1 py-2 border border-border/50 text-muted-foreground text-sm font-mono rounded hover:border-border transition-colors">
                Close
              </button>
            </div>
            <p className="text-xs text-muted-foreground/40 font-mono mt-4 text-center">
              For a custom domain, deploy to production from the top menu.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col h-[calc(100vh-6rem)] -m-6">

        {/* ── Top Header ── */}
        <div className="border-b border-border/50 bg-secondary/30 px-4 py-2 shrink-0 flex flex-col gap-2">

          {/* Row 1: project name + tab toggle + action buttons */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-display font-bold text-sm text-glow truncate">{project.name}</h2>
              <Badge variant={project.status === 'building' ? 'default' : 'outline'} className="shrink-0 text-[10px]">
                {project.status === 'building' && <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />}
                {project.status.toUpperCase()}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Code / Live Preview / Agent toggle */}
              <div className="flex bg-background border border-border cyber-clip">
                <Button size="sm" variant={activeTab === 'editor'  ? 'default' : 'ghost'} onClick={() => setActiveTab('editor')}  className="h-7 px-3 text-xs rounded-none">Code</Button>
                <Button size="sm" variant={activeTab === 'preview' ? 'accent'  : 'ghost'} onClick={() => setActiveTab('preview')} className="h-7 px-3 text-xs rounded-none">Live Preview</Button>
                <Button size="sm" variant={activeTab === 'agent'   ? 'default' : 'ghost'} onClick={() => setActiveTab('agent')}   className="h-7 px-3 text-xs rounded-none gap-1">
                  <Terminal className="w-3 h-3" />Agent
                </Button>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={rebuild}
                disabled={isRebuilding || project.status === 'building'}
                title="Rebuild with AI"
                className="h-7 px-2 gap-1 text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRebuilding || project.status === 'building' ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{isRebuilding || project.status === 'building' ? 'Building...' : 'Rebuild'}</span>
              </Button>
              <Button
                size="sm"
                onClick={deploy}
                disabled={isDeploying || project.status === 'building' || !project.generatedCode}
                title="Deploy & get shareable URL"
                className="h-7 px-3 text-xs glow-primary-hover gap-1 bg-primary text-background hover:brightness-110"
              >
                {isDeploying
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="hidden sm:inline">Deploying...</span></>
                  : <><Rocket className="w-3.5 h-3.5" /><span className="hidden sm:inline">{project.status === 'deployed' ? 'Redeploy' : 'Deploy'}</span></>
                }
              </Button>
            </div>
          </div>

          {/* Deploy success banner */}
          {project.status === 'deployed' && project.deployedUrl && !showDeployModal && (
            <div className="flex items-center gap-2 text-xs font-mono bg-green-500/10 border border-green-500/30 rounded px-3 py-1.5 text-green-400">
              <Rocket className="w-3 h-3 shrink-0" />
              <span className="truncate">Live: <a href={project.deployedUrl} target="_blank" rel="noreferrer" className="underline hover:text-green-300">{project.deployedUrl}</a></span>
              <button onClick={() => { setDeployedUrl(project.deployedUrl!); setShowDeployModal(true); }} className="ml-auto shrink-0 hover:text-green-300">Share</button>
            </div>
          )}

          {/* Row 2: device + preview controls (only when preview tab active) */}
          {activeTab === 'preview' && (
            <div className="flex items-center justify-between gap-2 flex-wrap">

              {/* Device picker */}
              <div className="flex items-center gap-1 bg-background/60 border border-border/50 rounded p-0.5">
                {DEVICES.map(d => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setDevice(d.id)}
                      title={d.label + (d.width ? ` (${d.width}px)` : '')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-all ${
                        device === d.id
                          ? 'bg-primary text-background font-semibold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{d.label}</span>
                      {d.width && <span className="hidden md:inline opacity-60 text-[10px]">{d.width}px</span>}
                    </button>
                  );
                })}
              </div>

              {/* Right side utilities */}
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={refreshPreview} title="Refresh preview" className="h-7 px-2 gap-1">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Refresh</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLogsOpen(!logsOpen)} className="h-7 px-2 gap-1">
                  {logsOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline text-xs">Logs</span>
                </Button>
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1">
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-xs">Open</span>
                  </Button>
                </a>
              </div>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 flex overflow-hidden">

          {/* CODE TAB — 3-pane */}
          {activeTab === 'editor' && (
            <>
              <div className="w-52 border-r border-border/50 bg-background/50 flex flex-col shrink-0">
                <div className="p-2 border-b border-border/30 text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center">
                  <Folder className="w-3 h-3 mr-2 text-primary" /> Explorer
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  <FileTreeNode name="src" type="directory" expanded>
                    <FileTreeNode name="components" type="directory" />
                    <FileTreeNode name="pages" type="directory" />
                    <FileTreeNode name="App.tsx"    type="file" active={selectedFile === 'src/App.tsx'}    onClick={() => setSelectedFile('src/App.tsx')} />
                    <FileTreeNode name="index.css"  type="file" active={selectedFile === 'src/index.css'}  onClick={() => setSelectedFile('src/index.css')} />
                  </FileTreeNode>
                  <FileTreeNode name="package.json"   type="file" />
                  <FileTreeNode name="vite.config.ts" type="file" />
                </div>
              </div>

              <div className="flex-1 flex flex-col bg-secondary/10 overflow-hidden">
                <div className="h-8 border-b border-border/30 flex items-center px-4 bg-background/80 font-mono text-xs text-muted-foreground">
                  {selectedFile || "No file selected"}
                </div>
                <textarea
                  className="flex-1 w-full bg-transparent p-4 font-mono text-sm text-[#E0E2EA] resize-none outline-none selection:bg-primary/30"
                  spellCheck={false}
                  value={editorCode}
                  readOnly
                  onChange={() => {}}
                />
              </div>

              <div className="w-72 border-l border-border/50 bg-background/50 flex flex-col shrink-0">
                <LogsPanel logs={logs} isBuilding={project.status === 'building'} />
              </div>
            </>
          )}

          {/* PREVIEW TAB — full-width with device framing */}
          {activeTab === 'preview' && (
            <div className="flex-1 flex overflow-hidden relative">

              {/* Preview canvas */}
              <div className="flex-1 flex flex-col items-center overflow-auto bg-[#0a0a0f]">
                {project.status === 'building' ? (
                  <BuildingState logs={logs} />
                ) : (
                  <>
                    {project.type === 'game' && (
                      <div className="w-full text-center py-1.5 bg-accent/10 border-b border-accent/20 text-xs font-mono text-accent/70">
                        🎮 Click inside the game to activate keyboard controls
                      </div>
                    )}
                    <DeviceFrame device={currentDevice}>
                      <iframe
                        ref={iframeRef}
                        key={project.id}
                        src={previewUrl}
                        className="w-full h-full border-0 block"
                        title={`Preview: ${project.name}`}
                        sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock"
                      />
                    </DeviceFrame>
                  </>
                )}
              </div>

              {/* Slide-in Swarm Logs */}
              {logsOpen && (
                <div className="w-72 border-l border-border/50 bg-background/95 flex flex-col shrink-0 z-10 shadow-2xl">
                  <div className="p-2 border-b border-border/30 flex items-center justify-between">
                    <span className="text-xs font-mono text-accent uppercase tracking-wider flex items-center gap-1.5">
                      <Terminal className="w-3 h-3" /> Swarm Logs
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setLogsOpen(false)} className="h-6 w-6 p-0 text-muted-foreground">×</Button>
                  </div>
                  <LogsPanel logs={logs} isBuilding={project.status === 'building'} />
                </div>
              )}
            </div>
          )}

          {/* AGENT TAB — chat terminal */}
          {activeTab === 'agent' && (
            <AgentTerminal projectId={project.id} projectName={project.name} />
          )}
        </div>
      </div>
    </AppLayout>
  );
}

/* ── Agent step definitions ── */
const STEP_MAP: Record<string, string[]> = {
  feature: [
    "🧠 [Orchestrator] Parsing feature request and routing to agents...",
    "🏗️ [Software Architect] Designing integration point in codebase...",
    "💻 [Code Generator] Writing feature implementation...",
    "🎨 [UI/UX Agent] Building interface components...",
    "🔐 [Security Agent] Reviewing for vulnerabilities...",
    "🧪 [Testing Agent] Running automated test suite...",
    "📦 [DevOps Agent] Bundling and hot-reloading preview...",
    "✅ [Orchestrator] Feature applied successfully.",
  ],
  bug: [
    "🧠 [Orchestrator] Analyzing error report...",
    "🔍 [Debugging Agent] Scanning codebase for root cause...",
    "🧩 [Code Analyzer] Tracing call stack and state...",
    "💻 [Code Generator] Applying targeted fix...",
    "🧪 [Testing Agent] Confirming bug is resolved...",
    "✅ [Orchestrator] Bug fixed and verified.",
  ],
  design: [
    "🧠 [Orchestrator] Briefing the design team...",
    "🎨 [UI/UX Design Agent] Generating new layout concepts...",
    "🖌️ [Design System Agent] Updating component tokens...",
    "💻 [Code Generator] Implementing visual changes...",
    "📱 [Responsive Agent] Testing across all breakpoints...",
    "✅ [Orchestrator] Redesign complete.",
  ],
  page: [
    "🧠 [Orchestrator] Planning page structure...",
    "🏗️ [Software Architect] Defining route and data flow...",
    "💻 [Code Generator] Scaffolding page component...",
    "🔗 [Router Agent] Wiring navigation links...",
    "🎨 [UI/UX Agent] Applying page styling...",
    "✅ [Orchestrator] New page added and linked.",
  ],
  auth: [
    "🧠 [Orchestrator] Initiating authentication module...",
    "🔐 [Security Agent] Designing auth flow and token strategy...",
    "🗄️ [Database Agent] Adding users table and session schema...",
    "💻 [Code Generator] Building login / signup screens...",
    "🛡️ [Middleware Agent] Protecting routes with auth guards...",
    "🧪 [Testing Agent] Testing auth edge cases...",
    "✅ [Orchestrator] Authentication integrated.",
  ],
  database: [
    "🧠 [Orchestrator] Planning data model...",
    "🗄️ [Database Agent] Designing schema and relations...",
    "⚡ [Migration Agent] Generating migration files...",
    "💻 [Code Generator] Wiring ORM layer to API...",
    "🧪 [Testing Agent] Validating queries...",
    "✅ [Orchestrator] Database layer ready.",
  ],
  optimize: [
    "🧠 [Orchestrator] Profiling application performance...",
    "⚡ [Performance Agent] Identifying bottlenecks...",
    "💻 [Code Generator] Lazy-loading heavy modules...",
    "🗜️ [Asset Agent] Compressing and caching assets...",
    "🧪 [Testing Agent] Measuring before/after metrics...",
    "✅ [Orchestrator] Optimization applied.",
  ],
  theme: [
    "🧠 [Orchestrator] Loading design system...",
    "🎨 [UI/UX Agent] Generating dark/light token sets...",
    "💻 [Code Generator] Adding theme context and toggle...",
    "🖌️ [Design System Agent] Updating component variants...",
    "✅ [Orchestrator] Theme toggle active.",
  ],
  mobile: [
    "🧠 [Orchestrator] Auditing responsive breakpoints...",
    "📱 [Responsive Agent] Fixing layout at mobile widths...",
    "🎨 [UI/UX Agent] Adjusting touch targets and spacing...",
    "💻 [Code Generator] Applying media queries...",
    "✅ [Orchestrator] Mobile layout complete.",
  ],
  api: [
    "🧠 [Orchestrator] Designing endpoint contract...",
    "🏗️ [Software Architect] Planning request/response schema...",
    "💻 [Code Generator] Scaffolding route with validation...",
    "🔐 [Security Agent] Adding rate limiting and auth checks...",
    "🧪 [Testing Agent] Running integration tests...",
    "✅ [Orchestrator] API endpoint deployed.",
  ],
  ai: [
    "🧠 [Orchestrator] Planning AI integration strategy...",
    "🤖 [AI Agent] Selecting model and prompt design...",
    "💻 [Code Generator] Integrating inference API calls...",
    "🎨 [UI/UX Agent] Building AI interaction interface...",
    "🔐 [Security Agent] Securing API keys...",
    "✅ [Orchestrator] AI feature integrated.",
  ],
  default: [
    "🧠 [Orchestrator] Parsing your request...",
    "🏗️ [Software Architect] Evaluating approach...",
    "💻 [Code Generator] Implementing changes...",
    "🎨 [UI/UX Agent] Refining interface...",
    "🧪 [Testing Agent] Verifying output...",
    "✅ [Orchestrator] Task complete.",
  ],
};

function getStepsForMessage(text: string): string[] {
  const t = text.toLowerCase();
  if (t.includes("fix bug") || t.includes("bug") || t.includes("broken") || t.includes("error")) return STEP_MAP.bug;
  if (t.includes("redesign") || t.includes("design") || t.includes("color") || t.includes("colour") || t.includes("look")) return STEP_MAP.design;
  if (t.includes("add page") || t.includes("page") || t.includes("route") || t.includes("screen")) return STEP_MAP.page;
  if (t.includes("auth") || t.includes("login") || t.includes("sign in")) return STEP_MAP.auth;
  if (t.includes("database") || t.includes("db") || t.includes("schema")) return STEP_MAP.database;
  if (t.includes("optim") || t.includes("performance") || t.includes("speed") || t.includes("fast")) return STEP_MAP.optimize;
  if (t.includes("dark mode") || t.includes("theme") || t.includes("dark/light")) return STEP_MAP.theme;
  if (t.includes("mobile") || t.includes("responsive")) return STEP_MAP.mobile;
  if (t.includes("api") || t.includes("endpoint") || t.includes("backend")) return STEP_MAP.api;
  if (t.includes("ai integration") || t.includes("ai feature") || t.includes("openai")) return STEP_MAP.ai;
  if (t.includes("feature") || t.includes("add feature")) return STEP_MAP.feature;
  return STEP_MAP.default;
}

/* ── Agent Terminal ── */
function AgentTerminal({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      content: `Agent swarm standing by for "${projectName}". You can ask me to add features, fix bugs, redesign UI, add pages, integrate auth, set up a database, or anything else. Use the quick actions below or type your own instruction.`,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeSteps, setActiveSteps] = useState<string[]>([]);
  const [stepsDone, setStepsDone] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeSteps]);

  const sendMessage = useCallback(async (text: string, action?: string) => {
    const userText = (text.trim() || action || "").trim();
    if (!userText) return;

    setIsLoading(true);
    setActiveSteps([]);
    setStepsDone(false);

    const userMsg: ChatMessage = { role: "user", content: userText, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");

    const steps = getStepsForMessage(userText);
    const STEP_MS = 750;

    let stepIdx = 0;
    intervalRef.current = setInterval(() => {
      stepIdx += 1;
      setActiveSteps(steps.slice(0, stepIdx));
      if (stepIdx >= steps.length) {
        clearInterval(intervalRef.current!);
        setStepsDone(true);
      }
    }, STEP_MS);

    let apiReply = "Task received — agents are processing your request.";
    try {
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("nexus-token") : null;
      const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ message: text.trim() || undefined, action }),
      });
      const data = await res.json();
      apiReply = data.reply || apiReply;
    } catch {
      apiReply = "Request queued — the swarm will process this when connectivity is restored.";
    }

    const totalStepTime = steps.length * STEP_MS + 400;
    const elapsed = steps.length * STEP_MS;
    const remaining = Math.max(0, totalStepTime - elapsed);

    await new Promise(r => setTimeout(r, remaining));

    clearInterval(intervalRef.current!);
    setActiveSteps(steps);
    setStepsDone(true);

    await new Promise(r => setTimeout(r, 500));

    setActiveSteps([]);
    setStepsDone(false);
    setMessages(prev => [...prev, {
      role: "agent",
      content: apiReply,
      timestamp: new Date().toISOString(),
    }]);
    setIsLoading(false);
    inputRef.current?.focus();
  }, [projectId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#06060f]">

      {/* Quick actions grid */}
      <div className="shrink-0 border-b border-border/40 bg-secondary/10 p-3">
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-primary" /> Quick Actions
        </p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map(qa => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.action}
                disabled={isLoading}
                onClick={() => sendMessage("", qa.action)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border/40 bg-background/40 text-xs text-muted-foreground font-mono hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Icon className="w-3 h-3" />
                {qa.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-sm">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`shrink-0 w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold border ${
              msg.role === 'agent'
                ? 'bg-primary/10 border-primary/40 text-primary'
                : 'bg-accent/10 border-accent/40 text-accent'
            }`}>
              {msg.role === 'agent' ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
            </div>
            <div className={`max-w-[80%] rounded px-3 py-2 text-xs leading-relaxed ${
              msg.role === 'agent'
                ? 'bg-secondary/30 border border-border/30 text-[#E0E2EA]'
                : 'bg-primary/10 border border-primary/30 text-primary'
            }`}>
              {msg.role === 'agent' && (
                <div className="text-[10px] text-primary/60 mb-1 uppercase tracking-wider">Nexus Agent</div>
              )}
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              <div className="text-[9px] text-muted-foreground/40 mt-1.5 text-right">
                {format(new Date(msg.timestamp), 'HH:mm:ss')}
              </div>
            </div>
          </div>
        ))}

        {/* Live agent progress */}
        {isLoading && activeSteps.length > 0 && (
          <div className="flex gap-3">
            <div className="shrink-0 w-7 h-7 rounded flex items-center justify-center border bg-primary/10 border-primary/40 text-primary">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 bg-secondary/20 border border-primary/20 rounded px-3 py-2 space-y-1.5 max-w-[85%]">
              <div className="text-[10px] text-primary/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                Swarm Working...
              </div>
              {activeSteps.map((step, i) => (
                <div
                  key={i}
                  className={`text-[11px] font-mono flex items-start gap-1.5 transition-all ${
                    i === activeSteps.length - 1 ? 'text-primary' : 'text-muted-foreground/60'
                  }`}
                >
                  {i === activeSteps.length - 1 && !stepsDone ? (
                    <Loader2 className="w-3 h-3 animate-spin shrink-0 mt-0.5" />
                  ) : (
                    <span className="shrink-0 mt-0.5 text-[10px]">›</span>
                  )}
                  <span>{step}</span>
                </div>
              ))}
              {!stepsDone && activeSteps.length === 0 && (
                <div className="flex items-center gap-1.5 text-xs text-primary/60">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Dispatching agents...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Initial dispatching (before first step appears) */}
        {isLoading && activeSteps.length === 0 && (
          <div className="flex gap-3">
            <div className="shrink-0 w-7 h-7 rounded flex items-center justify-center border bg-primary/10 border-primary/40 text-primary">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="bg-secondary/20 border border-primary/20 rounded px-3 py-2">
              <div className="text-[10px] text-primary/60 mb-1.5 uppercase tracking-wider">Nexus Agent</div>
              <div className="flex items-center gap-2 text-xs text-primary/70">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Dispatching swarm agents...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border/40 p-3 bg-secondary/10">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell the agent what to build or change… (Enter to send, Shift+Enter for new line)"
            rows={2}
            disabled={isLoading}
            className="flex-1 bg-background/60 border border-border/50 rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 resize-none outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all disabled:opacity-50"
          />
          <Button
            size="sm"
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            className="h-[52px] px-3 glow-primary-hover"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[9px] text-muted-foreground/30 mt-1.5 font-mono">
          21 SPECIALIZED AGENTS READY · SWARM STATUS: ONLINE
        </p>
      </div>
    </div>
  );
}

/* ── Device frame wrapper ── */
function DeviceFrame({
  device,
  children,
}: {
  device: typeof DEVICES[number];
  children: React.ReactNode;
}) {
  if (!device.width) {
    return <div className="flex-1 w-full h-full">{children}</div>;
  }

  const isPhone  = device.id === 'mobile';
  const isTablet = device.id === 'tablet';

  return (
    <div className="flex flex-col items-center justify-start py-6 px-4 min-h-full w-full">
      <div className="text-xs font-mono text-muted-foreground/60 mb-3 tracking-widest uppercase">
        {device.label} — {device.width} × {device.height}
      </div>

      <div
        className="relative flex-shrink-0 rounded-[2rem] overflow-hidden shadow-2xl"
        style={{
          width: Math.min(device.width, 600),
          border: isPhone  ? '6px solid #1e1e2e' :
                  isTablet ? '8px solid #1e1e2e' :
                             '2px solid #2d2d4e',
          borderRadius: isPhone  ? '2.5rem' :
                        isTablet ? '1.5rem' :
                                   '0.5rem',
          boxShadow: '0 0 0 1px rgba(0,212,255,0.15), 0 30px 80px rgba(0,0,0,0.6)',
        }}
      >
        {isPhone && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-[#1e1e2e] rounded-b-2xl z-10" />
        )}

        <div style={{ height: Math.min(device.height ?? 800, 700), width: '100%', overflow: 'hidden' }}>
          {children}
        </div>

        {isPhone && (
          <div className="flex justify-center items-center bg-[#1e1e2e] py-2">
            <div className="w-24 h-1 rounded-full bg-white/20" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Building state ── */
function BuildingState({ logs }: { logs: any[] | undefined }) {
  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-6 text-muted-foreground font-mono p-8 w-full">
      <div className="relative">
        <div className="w-20 h-20 rounded-full border-2 border-primary/20 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ping" style={{ animationDuration: '2s' }} />
      </div>
      <div className="text-center space-y-2">
        <p className="text-primary text-sm font-semibold tracking-widest uppercase">Agent Swarm Active</p>
        <p className="text-xs text-muted-foreground">Building your application — preview will appear automatically when complete</p>
      </div>
      <div className="w-full max-w-sm space-y-2 bg-secondary/20 rounded p-3 border border-border/30">
        {(logs || []).slice(-5).map((log, i) => (
          <div key={i} className="text-xs font-mono text-muted-foreground/70 truncate">
            <span className="text-primary/60">&gt;</span> {log.message}
          </div>
        ))}
        <div className="flex items-center gap-2 text-xs text-primary/80 mt-1">
          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          <span className="animate-pulse">Processing...</span>
        </div>
      </div>
    </div>
  );
}

/* ── Logs panel ── */
function LogsPanel({ logs, isBuilding }: { logs: any[] | undefined; isBuilding: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs">
      {logs?.length ? logs.map(log => (
        <div key={log.id} className="border-l-2 pl-2 pb-2" style={{ borderColor: getLogLevelColor(log.level) }}>
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mb-1">
            <span className="text-primary">{log.agentName}</span>
            <span>{format(new Date(log.timestamp), 'HH:mm:ss')}</span>
          </div>
          <div className="text-[#E0E2EA] leading-relaxed break-words">{log.message}</div>
        </div>
      )) : (
        <div className="text-muted-foreground opacity-50 italic">Waiting for agent activity...</div>
      )}
      {isBuilding && (
        <div className="border-l-2 border-primary pl-2 pb-2 animate-pulse">
          <div className="text-[10px] text-muted-foreground mb-1"><span className="text-primary">System</span></div>
          <div className="text-primary">_</div>
        </div>
      )}
    </div>
  );
}

/* ── File tree ── */
function FileTreeNode({ name, type, expanded = false, active = false, children, onClick }: any) {
  return (
    <div className="font-mono text-sm">
      <div
        className={`flex items-center py-1 px-2 cursor-pointer hover:bg-secondary/50 rounded-sm ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
        onClick={onClick}
      >
        {type === 'directory'
          ? <ChevronRight className={`w-3 h-3 mr-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          : <FileCode2 className="w-3 h-3 mr-1 ml-4" />}
        {name}
      </div>
      {expanded && children && (
        <div className="ml-3 border-l border-border/30 pl-1">{children}</div>
      )}
    </div>
  );
}

function getLogLevelColor(level: string) {
  switch (level) {
    case 'error':   return 'hsl(var(--destructive))';
    case 'warn':    return 'hsl(var(--chart-5))';
    case 'success': return 'hsl(var(--chart-4))';
    default:        return 'hsl(var(--primary))';
  }
}

const MOCK_CODE = `import React from 'react';

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <h1 className="text-4xl font-bold text-cyan-400">
        Hello World
      </h1>
      <p className="mt-4">Generated by Nexus Agents</p>
    </div>
  );
}`;
