import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, Loader2, ChevronRight, ChevronDown, Folder, FolderOpen, Activity, Zap, Cpu } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/cyber-ui";

/* ────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────── */
interface ChatMsg {
  role: "user" | "agent";
  content: string;
  timestamp: string;
}

export interface WorkBlock {
  id: string;
  userMessage: string;
  startedAt: number;
  completedAt: number | null;
  steps: string[];
  buildLogs: string[];
  agents: string[];
  reply: string | null;
}

/* ────────────────────────────────────────────────
   HYDRA-PRIME 7-Layer Swarm Agents (24 total)
   Layers: 1=SOVEREIGN · 2=ARCHITECT COUNCIL ·
           3=DEPARTMENT HEADS · 4=FRACTAL WORKERS ·
           5=CRITIC RING · 6=SYNTHESIZER · 7=VALIDATOR
   ──────────────────────────────────────────────── */
const SWARM_AGENTS: Array<{
  key: string;
  name: string;
  short: string;
  color: string;
  layer: number;
}> = [
  // Layer 1 — SOVEREIGN
  { key: "sovereign",   name: "SOVEREIGN",         short: "SOV", color: "accent",  layer: 1 },
  // Layer 2 — Architect Council
  { key: "sysarch",     name: "Sys Architect",      short: "SYS", color: "primary", layer: 2 },
  { key: "uxarch",      name: "UX Architect",       short: "UXA", color: "accent",  layer: 2 },
  { key: "dataarch",    name: "Data Architect",     short: "DAT", color: "cyan",    layer: 2 },
  { key: "secarch",     name: "Security Architect", short: "SEC", color: "red",     layer: 2 },
  { key: "opsarch",     name: "DevOps Architect",   short: "OPS", color: "primary", layer: 2 },
  // Layer 3 — Department Heads
  { key: "fe",          name: "Frontend Head",      short: "FE",  color: "green",   layer: 3 },
  { key: "be",          name: "Backend Head",       short: "BE",  color: "primary", layer: 3 },
  { key: "db",          name: "Database Head",      short: "DB",  color: "cyan",    layer: 3 },
  { key: "mob",         name: "Mobile Head",        short: "MOB", color: "primary", layer: 3 },
  { key: "gme",         name: "GameEngine Head",    short: "GME", color: "yellow",  layer: 3 },
  { key: "aiml",        name: "AI/ML Head",         short: "AIM", color: "accent",  layer: 3 },
  { key: "authh",       name: "Auth Head",          short: "ATH", color: "yellow",  layer: 3 },
  { key: "pay",         name: "Payments Head",      short: "PAY", color: "green",   layer: 3 },
  { key: "dvo",         name: "DevOps Head",        short: "DVO", color: "primary", layer: 3 },
  { key: "qa",          name: "QA Head",            short: "QA",  color: "green",   layer: 3 },
  { key: "docs",        name: "Docs Head",          short: "DOC", color: "cyan",    layer: 3 },
  // Layer 4 — Fractal Workers
  { key: "worker",      name: "Worker Pods",        short: "WRK", color: "yellow",  layer: 4 },
  { key: "fractal",     name: "Fractal Sub-swarm",  short: "FRC", color: "cyan",    layer: 4 },
  // Layer 5 — Critic Ring
  { key: "bughunt",     name: "Bug Hunter",         short: "BUG", color: "red",     layer: 5 },
  { key: "secaudit",    name: "Sec Auditor",        short: "AUD", color: "red",     layer: 5 },
  { key: "uxcrit",      name: "UX Critic",          short: "UXC", color: "accent",  layer: 5 },
  // Layer 6 — Synthesizer
  { key: "synth",       name: "Synthesizer",        short: "SYN", color: "accent",  layer: 6 },
  // Layer 7 — Validator
  { key: "valid",       name: "Validator",          short: "VAL", color: "green",   layer: 7 },
];

/** Map a free-text agent label (from a build log) to a swarm-grid key. */
export function matchAgent(text: string): string | null {
  const t = text.toLowerCase();
  // Layer 1
  if (t.includes("sovereign"))                                    return "sovereign";
  // Layer 2
  if (t.includes("systemarchitect") || t.includes("sys arch"))   return "sysarch";
  if (t.includes("uxarchitect")     || t.includes("ux arch"))    return "uxarch";
  if (t.includes("dataarchitect")   || t.includes("data arch"))  return "dataarch";
  if (t.includes("securityarchitect")|| t.includes("sec arch"))  return "secarch";
  if (t.includes("devopsarchitect") || t.includes("ops arch"))   return "opsarch";
  // Layer 3
  if (t.includes("frontend head")   || t.includes("frontend-w")) return "fe";
  if (t.includes("backend head")    || t.includes("backend-w"))  return "be";
  if (t.includes("database head")   || t.includes("database-w")) return "db";
  if (t.includes("mobileios")       || t.includes("mobileandroid") || t.includes("mobile head")) return "mob";
  if (t.includes("gameengine"))                                   return "gme";
  if (t.includes("aiml")            || t.includes("ai/ml"))      return "aiml";
  if (t.includes("auth head")       || t.includes("auth-w"))     return "authh";
  if (t.includes("payments head")   || t.includes("payments-w")) return "pay";
  if (t.includes("devops head")     || t.includes("devops-w"))   return "dvo";
  if (t.includes("qa head")         || t.includes("qa-w"))       return "qa";
  if (t.includes("docs head")       || t.includes("docs-w"))     return "docs";
  // Layer 4
  if (t.includes("splitter")        || t.includes("fractal"))    return "fractal";
  if (t.includes("-w-")             || t.includes("worker"))     return "worker";
  // Layer 5
  if (t.includes("bughunter")       || t.includes("bug hunt") || t.includes("debugging agent") || t.includes("debug")) return "bughunt";
  if (t.includes("securityauditor") || t.includes("sec audit") || t.includes("security auditor") || t.includes("security agent")) return "secaudit";
  if (t.includes("uxcritic")        || t.includes("ux critic"))  return "uxcrit";
  // Layer 6
  if (t.includes("synthesizer")     || t.includes("synth"))      return "synth";
  // Layer 7
  if (t.includes("validator")       || t.includes("packag") || t.includes("testing agent")) return "valid";
  // Broad fallbacks — cover the project-build agent names the server emits
  if (t.includes("orchestrat"))                                   return "sovereign";
  if (t.includes("software architect"))                           return "sysarch";
  if (t.includes("ui/ux")           || t.includes("ux agent"))   return "uxarch";
  if (t.includes("architect"))                                    return "sysarch";
  if (t.includes("code generator")  || t.includes("codegen"))    return "worker";
  if (t.includes("asset generator") || t.includes("asset"))      return "worker";
  if (t.includes("devops engineer") || t.includes("devops"))     return "dvo";
  if (t.includes("payment")         || t.includes("stripe"))     return "pay";
  if (t.includes("auth"))                                         return "authh";
  if (t.includes("database"))                                     return "db";
  if (t.includes("mobile"))                                       return "mob";
  if (t.includes("game"))                                         return "gme";
  if (t.includes("fixer"))                                        return "bughunt";
  return null;
}

/* ──────────────────────────────────────────────────────────────
   Color classes per state (idle / active / done)
   ──────────────────────────────────────────────────────────── */
function colorClasses(color: string, state: "idle" | "active" | "done"): string {
  const map: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    primary: { bg: "bg-primary/15",  border: "border-primary/40",  text: "text-primary",   glow: "shadow-[0_0_12px_rgba(0,212,255,0.55)]"    },
    accent:  { bg: "bg-accent/15",   border: "border-accent/40",   text: "text-accent",    glow: "shadow-[0_0_12px_rgba(168,85,247,0.55)]"   },
    red:     { bg: "bg-red-500/15",  border: "border-red-500/40",  text: "text-red-400",   glow: "shadow-[0_0_12px_rgba(239,68,68,0.55)]"    },
    cyan:    { bg: "bg-cyan-400/15", border: "border-cyan-400/40", text: "text-cyan-300",  glow: "shadow-[0_0_12px_rgba(34,211,238,0.55)]"   },
    green:   { bg: "bg-green-400/15",border: "border-green-400/40",text: "text-green-300", glow: "shadow-[0_0_12px_rgba(74,222,128,0.55)]"   },
    yellow:  { bg: "bg-yellow-400/15",border:"border-yellow-400/40",text:"text-yellow-300",glow: "shadow-[0_0_12px_rgba(250,204,21,0.55)]"   },
  };
  const c = map[color] ?? map.primary;
  if (state === "active") return `${c.bg} ${c.border} ${c.text} ${c.glow} scale-105`;
  if (state === "done")   return "bg-green-400/10 border-green-400/50 text-green-300 shadow-[0_0_8px_rgba(74,222,128,0.35)]";
  return "bg-background/40 border-border/30 text-muted-foreground/50";
}

/* ────────────────────────────────────────────────
   Layer label config
   ──────────────────────────────────────────────── */
const LAYER_LABELS: Record<number, string> = {
  1: "L1·CEO",
  2: "L2·ARCH",
  3: "L3·DEPT",
  4: "L4·WORK",
  5: "L5·CRIT",
  6: "L6·SYNC",
  7: "L7·VALID",
};

/* ────────────────────────────────────────────────
   SwarmGrid — HYDRA-PRIME 7-layer live visualization
   ──────────────────────────────────────────────── */
export function SwarmGrid({
  activeKeys,
  completedKeys,
  isStreaming,
  currentTask,
  currentAgentKey,
  compact = false,
}: {
  activeKeys:      Set<string>;
  completedKeys?:  Set<string>;
  isStreaming:     boolean;
  currentTask?:    string | null;
  currentAgentKey?: string | null;
  compact?:        boolean;
}) {
  const done = completedKeys ?? new Set<string>();

  const activeAgent =
    (currentAgentKey && activeKeys.has(currentAgentKey)
      ? SWARM_AGENTS.find(a => a.key === currentAgentKey)
      : null) ??
    (activeKeys.size > 0
      ? SWARM_AGENTS.find(a => activeKeys.has(a.key))
      : null);

  // Group agents by layer for grouped display
  const layers = [1, 2, 3, 4, 5, 6, 7];

  return (
    <div className={`shrink-0 border-b border-primary/20 bg-gradient-to-b from-[#0a0a18] to-[#06060f] px-3 ${compact ? "py-2" : "py-2.5"}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded bg-accent/15 border border-accent/40 flex items-center justify-center shrink-0">
            <Cpu className="w-3 h-3 text-accent" />
          </div>
          <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-widest shrink-0">
            HYDRA-PRIME
          </span>
          <span className={`flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
            isStreaming
              ? "bg-accent/10 border-accent/30 text-accent"
              : done.size > 0
                ? "bg-green-400/10 border-green-400/30 text-green-300"
                : "bg-muted/20 border-border/40 text-muted-foreground"
          }`}>
            <span className={`w-1 h-1 rounded-full ${isStreaming ? "bg-accent animate-pulse" : done.size > 0 ? "bg-green-400" : "bg-muted-foreground"}`} />
            {isStreaming
              ? `${activeKeys.size} ACTIVE · ${done.size} DONE`
              : done.size > 0
                ? `${done.size} COMPLETE`
                : "STANDBY"}
          </span>
          {isStreaming && activeAgent && (
            <span className="text-[10px] font-mono text-accent/90 truncate max-w-[200px] hidden sm:inline">
              › {activeAgent.name}
              {currentTask ? <span className="text-muted-foreground/70"> — {currentTask}</span> : null}
            </span>
          )}
        </div>
        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest">
          {isStreaming ? "Processing…" : done.size > 0 ? "Build Complete" : "7 Layers · 24 Agents"}
        </span>
      </div>
      {/* Layer rows */}
      <div className="space-y-1.5">
        {layers.map(layer => {
          const agents = SWARM_AGENTS.filter(a => a.layer === layer);
          const label  = LAYER_LABELS[layer] ?? `L${layer}`;
          return (
            <div key={layer} className="flex items-center gap-1.5">
              <span className="text-[8px] font-mono text-muted-foreground/40 w-[46px] shrink-0 text-right">
                {label}
              </span>
              <div className="flex gap-1 flex-wrap">
                {agents.map(a => {
                  const active   = activeKeys.has(a.key);
                  const complete = !active && done.has(a.key);
                  const state: "idle" | "active" | "done" = active ? "active" : complete ? "done" : "idle";
                  return (
                    <div
                      key={a.key}
                      title={active ? `${a.name} — WORKING` : complete ? `${a.name} — COMPLETE` : a.name}
                      className={`relative flex items-center justify-center rounded border text-center transition-all duration-300 ${
                        compact ? "w-8 h-6" : "w-9 h-7"
                      } ${colorClasses(a.color, state)}`}
                    >
                      <span className="text-[8px] font-mono font-bold leading-none">{a.short}</span>
                      {active && (
                        <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-current animate-pulse" />
                      )}
                      {complete && (
                        <span className="absolute top-0.5 right-0.5 text-[7px] leading-none text-green-400 font-bold">✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   WorkBlockFolder — collapsible build log entry
   ──────────────────────────────────────────────── */
export function WorkBlockFolder({ block, defaultOpen = false }: { block: WorkBlock; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const dur = block.completedAt
    ? `${((block.completedAt - block.startedAt) / 1000).toFixed(1)}s`
    : "…";

  return (
    <div className="border border-border/30 rounded overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-secondary/10 transition-colors"
      >
        {open
          ? <FolderOpen className="w-3 h-3 text-accent/70 shrink-0" />
          : <Folder     className="w-3 h-3 text-muted-foreground/50 shrink-0" />
        }
        <span className="flex-1 text-[11px] font-mono text-foreground/80 truncate">{block.userMessage}</span>
        {block.completedAt
          ? <span className="text-[9px] font-mono text-green-400/70 shrink-0">{dur}</span>
          : <span className="text-[9px] font-mono text-accent/70 animate-pulse shrink-0">building…</span>
        }
        {open
          ? <ChevronDown  className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        }
      </button>
      {open && (
        <div className="border-t border-border/20 px-2 py-1.5 space-y-1">
          {block.steps.map((s, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] font-mono text-muted-foreground/70">
              <ChevronRight className="w-2.5 h-2.5 mt-0.5 text-accent/50 shrink-0" />
              {s}
            </div>
          ))}
          {block.reply && (
            <div className="mt-1.5 pt-1.5 border-t border-border/20 text-[11px] font-mono text-foreground/85 leading-snug">
              {block.reply}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────
   SwarmTerminal — main chat + swarm panel
   ──────────────────────────────────────────────── */
export function SwarmTerminal({
  projectId,
  onUpdateStarted,
}: {
  projectId: string;
  onUpdateStarted?: () => void;
}) {
  const [blocks, setBlocks]               = useState<WorkBlock[]>([]);
  const [isLoading, setIsLoading]         = useState(false);
  const [isStreaming, setIsStreaming]      = useState(false);
  const [input, setInput]                 = useState("");
  const [activeKeys, setActiveKeys]       = useState<Set<string>>(new Set());
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());
  const [currentTask, setCurrentTask]     = useState<string | null>(null);
  const [currentAgentKey, setCurrentAgentKey] = useState<string | null>(null);

  const esRef              = useRef<EventSource | null>(null);
  const bottomRef          = useRef<HTMLDivElement>(null);
  const activeKeyTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const pendingBuildRef    = useRef(false);
  const currentIdRef       = useRef<string | null>(null);
  const onUpdateStartedRef = useRef(onUpdateStarted);

  const greeting = {
    content: "HYDRA-PRIME SWARM v4 online. 7 layers · 24 agents · fractal sub-swarming enabled. Describe your project to engage the build pipeline.",
  };

  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/build-stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Server sends { msg, ts } — handle both that format and legacy { type, agent, text }
        const msg: string = data.msg ?? data.text ?? data.agent ?? "";

        if (msg === "__DONE__") {
          setIsStreaming(false);
          return;
        }

        if (msg.startsWith("__REPLY__:")) {
          // AI reply payload — not a swarm event, ignore for grid
          return;
        }

        if (!msg) return;

        setIsStreaming(true);
        setCurrentTask(msg);

        const key = matchAgent(msg);
        if (key) {
          setCurrentAgentKey(key);
          setActiveKeys(prev => { const n = new Set(prev); n.add(key); return n; });
          const t = setTimeout(() => {
            setActiveKeys(prev  => { const n = new Set(prev);  n.delete(key); return n; });
            setCompletedKeys(prev => { const n = new Set(prev); n.add(key);    return n; });
            activeKeyTimersRef.current.delete(t);
          }, 3000);
          activeKeyTimersRef.current.add(t);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => { setIsStreaming(false); };

    return () => {
      es.close();
      esRef.current = null;
      activeKeyTimersRef.current.forEach(t => clearTimeout(t));
      activeKeyTimersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks.length, isLoading]);

  // ── Send a chat message ───────────────────────────────────
  const send = useCallback(async (text: string) => {
    const userText = text.trim();
    if (!userText || isLoading) return;
    setIsLoading(true);
    setInput("");
    setIsStreaming(true);

    pendingBuildRef.current = true;
    const id = `wb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentIdRef.current = id;

    const newBlock: WorkBlock = {
      id, userMessage: userText, startedAt: Date.now(), completedAt: null,
      steps: [], buildLogs: [], agents: [], reply: null,
    };
    setBlocks(prev => [...prev, newBlock]);

    // HYDRA-themed narration steps
    const narrationSteps = [
      "SOVEREIGN analysing request and generating blueprint…",
      "Architect Council convening — 5 specialists in parallel…",
      "Department heads decomposing into atomic tasks…",
      "Fractal worker swarm spawning — up to 200 parallel agents…",
      "Critic ring running adversarial review…",
      "Synthesizer merging artifacts and resolving conflicts…",
      "Validator packaging output — README, .env, Dockerfile…",
    ];
    let i = 0;
    const stepInt = setInterval(() => {
      i++;
      setBlocks(prev => prev.map(b =>
        b.id === id ? { ...b, steps: narrationSteps.slice(0, i) } : b
      ));
      if (i >= narrationSteps.length) clearInterval(stepInt);
    }, 700);

    let reply = "HYDRA-PRIME engaged — swarm is processing your request.";

    try {
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("nexus-token") : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res  = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers,
        body:   JSON.stringify({ message: userText }),
      });
      const data = await res.json();
      reply = data.reply || reply;

      if (data.updating) {
        onUpdateStartedRef.current?.();
      } else {
        pendingBuildRef.current = false;
        setTimeout(() => {
          clearInterval(stepInt);
          setBlocks(prev => prev.map(b =>
            b.id === id && b.completedAt === null
              ? { ...b, completedAt: Date.now(), reply } : b
          ));
          if (currentIdRef.current === id) currentIdRef.current = null;
          setIsStreaming(false);
        }, narrationSteps.length * 700 + 400);
      }
    } catch {
      reply = "Request queued — HYDRA will retry when connectivity returns.";
    }

    setBlocks(prev => prev.map(b => b.id === id ? { ...b, reply } : b));
    setIsLoading(false);
  }, [projectId, isLoading, onUpdateStarted]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const lastIdx = blocks.length - 1;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#06060f]">
      {/* Live HYDRA 7-layer grid */}
      <SwarmGrid
        activeKeys={activeKeys}
        completedKeys={completedKeys}
        isStreaming={isStreaming}
        currentTask={currentTask}
        currentAgentKey={currentAgentKey}
      />

      {/* Greeting + work blocks */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2">
        {/* Greeting */}
        <div className="flex gap-2">
          <div className="shrink-0 w-6 h-6 rounded bg-accent/10 border border-accent/40 flex items-center justify-center">
            <Bot className="w-3 h-3 text-accent" />
          </div>
          <div className="flex-1 bg-secondary/20 border border-border/30 rounded px-2.5 py-1.5">
            <div className="text-[9px] text-accent/60 uppercase tracking-wider mb-0.5">HYDRA-PRIME SWARM</div>
            <p className="text-[11px] font-mono text-foreground/90 leading-snug">{greeting.content}</p>
          </div>
        </div>

        {/* Work blocks */}
        {blocks.map((b, i) => (
          <WorkBlockFolder key={b.id} block={b} defaultOpen={i === lastIdx} />
        ))}

        {blocks.length === 0 && (
          <div className="text-center py-6 text-[10px] font-mono text-muted-foreground/50">
            <Activity className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground/30" />
            No active build — describe your project below to engage the swarm.
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-accent/20 bg-secondary/10 p-2">
        <div className="flex gap-1.5 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Describe what to build — HYDRA will handle the rest…"
            rows={1}
            disabled={isLoading}
            className="flex-1 bg-background/60 border border-border/50 rounded px-2.5 py-1.5 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 resize-none outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all disabled:opacity-50 max-h-24"
          />
          <Button
            size="sm"
            onClick={() => send(input)}
            disabled={isLoading || !input.trim()}
            className="h-8 px-2.5 glow-primary-hover"
          >
            {isLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Send    className="w-3.5 h-3.5" />
            }
          </Button>
        </div>
        <p className="text-[8px] text-muted-foreground/30 mt-1 font-mono flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />
          HYDRA-PRIME · 7 LAYERS · 24 SPECIALISTS · FRACTAL SUB-SWARMING · CRITIC RING
        </p>
      </div>
    </div>
  );
}
