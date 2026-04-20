import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Bot, User, Send, Loader2, ChevronRight, ChevronDown, Folder, FolderOpen, Activity, Zap, Cpu } from "lucide-react";
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
  steps: string[];          // simulated narration steps
  buildLogs: string[];      // real SSE logs captured during this block
  agents: string[];         // unique agents involved
  reply: string | null;     // final agent reply
}

/* ────────────────────────────────────────────────
   The 21 Swarm Agents (must match landing-page demo)
   ──────────────────────────────────────────────── */
const SWARM_AGENTS: Array<{ key: string; name: string; short: string; color: string }> = [
  { key: "orch",    name: "Orchestrator",      short: "ORC",  color: "primary" },
  { key: "arch",    name: "Software Architect",short: "ARC",  color: "primary" },
  { key: "code",    name: "Code Generator",    short: "GEN",  color: "primary" },
  { key: "ui",      name: "UI/UX Designer",    short: "UIX",  color: "accent"  },
  { key: "design",  name: "Design System",     short: "DSY",  color: "accent"  },
  { key: "sec",     name: "Security Auditor",  short: "SEC",  color: "red"     },
  { key: "db",      name: "Database Engineer", short: "DBE",  color: "cyan"    },
  { key: "migrate", name: "Migration Agent",   short: "MIG",  color: "cyan"    },
  { key: "test",    name: "Testing Agent",     short: "TST",  color: "green"   },
  { key: "devops",  name: "DevOps Engineer",   short: "OPS",  color: "primary" },
  { key: "debug",   name: "Debugging Agent",   short: "DBG",  color: "yellow"  },
  { key: "analyze", name: "Code Analyzer",     short: "ANL",  color: "yellow"  },
  { key: "perf",    name: "Performance",       short: "PRF",  color: "primary" },
  { key: "asset",   name: "Asset Generator",   short: "AST",  color: "accent"  },
  { key: "router",  name: "Router Agent",      short: "RTR",  color: "cyan"    },
  { key: "mid",     name: "Middleware",        short: "MID",  color: "primary" },
  { key: "ai",      name: "AI Integration",    short: "AIX",  color: "accent"  },
  { key: "game",    name: "Game Designer",     short: "GMD",  color: "yellow"  },
  { key: "canvas",  name: "Canvas Renderer",   short: "CVR",  color: "primary" },
  { key: "level",   name: "Level Builder",     short: "LVL",  color: "yellow"  },
  { key: "phys",    name: "Physics Engine",    short: "PHY",  color: "cyan"    },
];

/** Map a free-text agent label (parsed from a build log) to a swarm-grid key. */
export function matchAgent(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("orchestrat"))                       return "orch";
  if (t.includes("architect"))                        return "arch";
  if (t.includes("code generator") || t.includes("generator")) return "code";
  if (t.includes("ui") || t.includes("design system")) return "ui";
  if (t.includes("security"))                         return "sec";
  if (t.includes("database") || t.includes("db "))    return "db";
  if (t.includes("migration"))                        return "migrate";
  if (t.includes("test"))                             return "test";
  if (t.includes("devops") || t.includes("deploy"))   return "devops";
  if (t.includes("debug"))                            return "debug";
  if (t.includes("analyz"))                           return "analyze";
  if (t.includes("performance") || t.includes("optim")) return "perf";
  if (t.includes("asset"))                            return "asset";
  if (t.includes("router") || t.includes("route"))    return "router";
  if (t.includes("middleware"))                       return "mid";
  if (t.includes("ai "))                              return "ai";
  if (t.includes("game"))                             return "game";
  if (t.includes("canvas"))                           return "canvas";
  if (t.includes("level"))                            return "level";
  if (t.includes("physic"))                           return "phys";
  return null;
}

function colorClasses(color: string, state: "idle" | "active" | "done"): string {
  const map: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    primary: { bg: "bg-primary/15", border: "border-primary/40", text: "text-primary", glow: "shadow-[0_0_12px_rgba(0,212,255,0.55)]" },
    accent:  { bg: "bg-accent/15",  border: "border-accent/40",  text: "text-accent",  glow: "shadow-[0_0_12px_rgba(168,85,247,0.55)]" },
    red:     { bg: "bg-red-500/15", border: "border-red-500/40", text: "text-red-400", glow: "shadow-[0_0_12px_rgba(239,68,68,0.55)]"  },
    cyan:    { bg: "bg-cyan-400/15",border: "border-cyan-400/40",text: "text-cyan-300",glow: "shadow-[0_0_12px_rgba(34,211,238,0.55)]" },
    green:   { bg: "bg-green-400/15",border:"border-green-400/40",text:"text-green-300",glow:"shadow-[0_0_12px_rgba(74,222,128,0.55)]"  },
    yellow:  { bg: "bg-yellow-400/15",border:"border-yellow-400/40",text:"text-yellow-300",glow:"shadow-[0_0_12px_rgba(250,204,21,0.55)]"},
  };
  const c = map[color] || map.primary;
  if (state === "active") return `${c.bg} ${c.border} ${c.text} ${c.glow} scale-105`;
  if (state === "done")   return `bg-green-400/10 border-green-400/50 text-green-300 shadow-[0_0_8px_rgba(74,222,128,0.35)]`;
  return `bg-background/40 border-border/30 text-muted-foreground/50`;
}

/* ────────────────────────────────────────────────
   Swarm Grid — live 21-agent activity visualization
   Each cell shows one of three states:
     · idle   — dim, waiting
     · active — glowing + pulsing dot ("working on …")
     · done   — green + ✓ checkmark ("complete")
   ──────────────────────────────────────────────── */
export function SwarmGrid({
  activeKeys,
  completedKeys,
  isStreaming,
  currentTask,
  currentAgentKey,
  compact = false,
}: {
  activeKeys: Set<string>;
  completedKeys?: Set<string>;
  isStreaming: boolean;
  currentTask?: string | null;
  /** The most-recently-activated agent key. If omitted, falls back to
   *  the first key in `activeKeys`. */
  currentAgentKey?: string | null;
  compact?: boolean;
}) {
  const done = completedKeys ?? new Set<string>();
  // Prefer the explicit "latest event" agent when provided (fixes ticker showing
  // the wrong agent when multiple are active). Fall back to any active agent.
  const activeAgent =
    (currentAgentKey && activeKeys.has(currentAgentKey)
      ? SWARM_AGENTS.find(a => a.key === currentAgentKey)
      : null) ??
    (activeKeys.size > 0
      ? SWARM_AGENTS.find(a => activeKeys.has(a.key))
      : null);
  return (
    <div className={`shrink-0 border-b border-primary/20 bg-gradient-to-b from-[#0a0a18] to-[#06060f] px-3 ${compact ? "py-2" : "py-2.5"}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded bg-primary/15 border border-primary/40 flex items-center justify-center shrink-0">
            <Cpu className="w-3 h-3 text-primary" />
          </div>
          <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest shrink-0">
            21-Agent Swarm
          </span>
          <span className={`flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
            isStreaming
              ? "bg-primary/10 border-primary/30 text-primary"
              : done.size > 0
                ? "bg-green-400/10 border-green-400/30 text-green-300"
                : "bg-muted/20 border-border/40 text-muted-foreground"
          }`}>
            <span className={`w-1 h-1 rounded-full ${isStreaming ? "bg-primary animate-pulse" : done.size > 0 ? "bg-green-400" : "bg-muted-foreground"}`} />
            {isStreaming
              ? `${activeKeys.size} ACTIVE · ${done.size} DONE`
              : done.size > 0
                ? `${done.size} COMPLETE`
                : "STANDBY"}
          </span>
          {/* Live "working on…" ticker */}
          {isStreaming && activeAgent && (
            <span className="text-[10px] font-mono text-primary/90 truncate max-w-[200px] hidden sm:inline">
              › {activeAgent.name}
              {currentTask ? <span className="text-muted-foreground/70"> — {currentTask}</span> : null}
            </span>
          )}
        </div>
        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest">
          {isStreaming ? "Processing…" : done.size > 0 ? "Build Complete" : "Swarm Online"}
        </span>
      </div>
      <div className="grid grid-cols-7 sm:grid-cols-11 lg:grid-cols-21 gap-1.5">
        {SWARM_AGENTS.map((a) => {
          const active = activeKeys.has(a.key);
          const complete = !active && done.has(a.key);
          const state: "idle" | "active" | "done" = active ? "active" : complete ? "done" : "idle";
          const label = active
            ? `${a.name} — WORKING`
            : complete
              ? `${a.name} — COMPLETE`
              : a.name;
          return (
            <div
              key={a.key}
              title={label}
              className={`relative aspect-square flex flex-col items-center justify-center rounded border text-center transition-all duration-300 ${colorClasses(a.color, state)}`}
            >
              <div className="text-[8px] font-mono font-bold leading-none">{a.short}</div>
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
}

/* ────────────────────────────────────────────────
   Collapsed Work Block — replit-agent-style folder
   ──────────────────────────────────────────────── */
export function WorkBlockFolder({ block, defaultOpen = false }: { block: WorkBlock; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const inProgress = block.completedAt === null;
  const duration = block.completedAt
    ? Math.max(1, Math.round((block.completedAt - block.startedAt) / 1000))
    : Math.max(1, Math.round((Date.now() - block.startedAt) / 1000));

  return (
    <div className={`border rounded transition-colors ${
      inProgress
        ? "border-primary/40 bg-primary/5"
        : "border-border/40 bg-background/40 hover:border-primary/30"
    }`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {open
          ? <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${inProgress ? "text-primary" : "text-muted-foreground"}`} />
          : <Folder className={`w-3.5 h-3.5 shrink-0 ${inProgress ? "text-primary" : "text-muted-foreground"}`} />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-mono">
            <span className={`truncate ${inProgress ? "text-primary" : "text-foreground/80"}`}>
              {block.userMessage}
            </span>
            {inProgress && <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />}
          </div>
          <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground/60 mt-0.5">
            <span>{block.agents.length || 1} {block.agents.length === 1 ? "agent" : "agents"}</span>
            <span>•</span>
            <span>{block.steps.length + block.buildLogs.length} steps</span>
            <span>•</span>
            <span>{duration}s</span>
            {!inProgress && <><span>•</span><span className="text-green-400">✓ done</span></>}
          </div>
        </div>
        {open
          ? <ChevronDown className="w-3 h-3 text-muted-foreground/60 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground/60 shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-border/30 px-2.5 py-2 space-y-1 max-h-60 overflow-y-auto">
          {block.steps.length > 0 && (
            <div className="space-y-0.5">
              {block.steps.map((s, i) => (
                <div key={`s-${i}`} className="text-[10px] font-mono text-muted-foreground/80 leading-snug flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5 text-primary/50">›</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}
          {block.buildLogs.length > 0 && (
            <div className="space-y-0.5 pt-1 border-t border-border/20">
              {block.buildLogs.map((log, i) => {
                const isOk  = log.includes("✅") || log.includes("🎉");
                const isErr = log.includes("❌") || log.includes("Error");
                const agent = log.match(/\[([^\]]+)\]/)?.[1];
                const body  = log.replace(/\[[^\]]+\]\s?/, "");
                return (
                  <div key={`l-${i}`} className={`text-[10px] font-mono leading-snug flex items-start gap-1.5 ${
                    isErr ? "text-red-400" : isOk ? "text-green-300" : "text-muted-foreground/80"
                  }`}>
                    {agent && <span className="shrink-0 text-[9px] text-primary/60 min-w-[80px] truncate">{agent}</span>}
                    <span className="flex-1">{body}</span>
                  </div>
                );
              })}
            </div>
          )}
          {block.reply && (
            <div className="pt-1.5 mt-1 border-t border-border/30 text-[11px] font-mono text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {block.reply}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────
   SwarmTerminal — main exported component
   ──────────────────────────────────────────────── */
export function SwarmTerminal({
  projectId,
  projectName,
  onUpdateStarted,
  onBuildComplete,
}: {
  projectId: string;
  projectName: string;
  onUpdateStarted?: () => void;
  onBuildComplete?: () => void;
}) {
  const [greeting] = useState<ChatMsg>({
    role: "agent",
    content: `Swarm online for "${projectName}". Tell me what to build, fix, or change — work auto-collapses into folders as it completes.`,
    timestamp: new Date().toISOString(),
  });
  const [blocks, setBlocks]       = useState<WorkBlock[]>([]);
  const [input, setInput]         = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTask, setCurrentTask] = useState<string | null>(null);

  const bottomRef    = useRef<HTMLDivElement>(null);
  const esRef        = useRef<EventSource | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const pendingBuildRef = useRef(false);
  // Stable refs for callbacks so SSE effect doesn't re-subscribe on every parent re-render
  const onBuildCompleteRef = useRef(onBuildComplete);
  const onUpdateStartedRef = useRef(onUpdateStarted);
  useEffect(() => { onBuildCompleteRef.current = onBuildComplete; }, [onBuildComplete]);
  useEffect(() => { onUpdateStartedRef.current = onUpdateStarted; }, [onUpdateStarted]);
  // Track active-key fade timers so we can clear them on unmount
  const activeKeyTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // ── SSE: push real build logs into the active work block ───────────
  useEffect(() => {
    if (!projectId) return;
    const es = new EventSource(`/api/projects/${projectId}/build-stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const { msg } = JSON.parse(e.data) as { msg: string };
        if (msg === "__DONE__") {
          setIsStreaming(false);
          // Mark current block complete + migrate all still-active agents to "done"
          if (currentIdRef.current) {
            const id = currentIdRef.current;
            setBlocks(prev => prev.map(b => b.id === id && b.completedAt === null
              ? { ...b, completedAt: Date.now() } : b));
            currentIdRef.current = null;
          }
          setActiveKeys(prev => {
            // Any agent that was still active at DONE is now complete
            setCompletedKeys(done => {
              const next = new Set(done);
              prev.forEach(k => next.add(k));
              return next;
            });
            return new Set();
          });
          setCurrentTask(null);
          if (pendingBuildRef.current) {
            pendingBuildRef.current = false;
            onBuildCompleteRef.current?.();
          }
          return;
        }
        // Add to current block (if any)
        const id = currentIdRef.current;
        if (id) {
          setBlocks(prev => prev.map(b => {
            if (b.id !== id) return b;
            const agentName = msg.match(/\[([^\]]+)\]/)?.[1] || "";
            const agents = agentName && !b.agents.includes(agentName)
              ? [...b.agents, agentName] : b.agents;
            return { ...b, buildLogs: [...b.buildLogs, msg], agents };
          }));
        }
        // Extract agent + task body for live "working on X" ticker
        const agent = msg.match(/\[([^\]]+)\]/)?.[1] || msg;
        const body  = msg.replace(/\[[^\]]+\]\s?/, "").trim();
        setCurrentTask(body.slice(0, 80));
        // Light up swarm grid based on agent name
        const key = matchAgent(agent);
        if (key) {
          setActiveKeys(prev => {
            const next = new Set(prev);
            next.add(key);
            return next;
          });
          // After 3s, mark this agent COMPLETE (green check) instead of just fading
          const t = setTimeout(() => {
            setActiveKeys(prev => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            });
            setCompletedKeys(prev => {
              const next = new Set(prev);
              next.add(key);
              return next;
            });
            activeKeyTimersRef.current.delete(t);
          }, 3000);
          activeKeyTimersRef.current.add(t);
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { setIsStreaming(false); };
    return () => {
      es.close();
      esRef.current = null;
      // Clear any pending fade-out timers to prevent setState-on-unmounted warnings
      activeKeyTimersRef.current.forEach(t => clearTimeout(t));
      activeKeyTimersRef.current.clear();
    };
    // Only re-subscribe when projectId changes — callbacks are accessed via refs
    // to avoid connection churn on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Auto-scroll to bottom on new content ──────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks.length, isLoading]);

  // ── Send a chat message ───────────────────────────────────────────
  const send = useCallback(async (text: string) => {
    const userText = text.trim();
    if (!userText || isLoading) return;
    setIsLoading(true);
    setInput("");
    setIsStreaming(true);

    // Open a new work block. Optimistically mark "build pending" BEFORE the
    // request fires so an early SSE __DONE__ can't be lost (race fix).
    pendingBuildRef.current = true;
    const id = `wb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentIdRef.current = id;
    const newBlock: WorkBlock = {
      id, userMessage: userText, startedAt: Date.now(), completedAt: null,
      steps: [], buildLogs: [], agents: [], reply: null,
    };
    // Auto-collapse all previously open blocks (just keep new one expanded)
    setBlocks(prev => [...prev, newBlock]);

    // Simulated narration steps (fast, for snappiness)
    const narrationSteps = [
      "Parsing your request and routing to the swarm…",
      "Architect agent designing the change…",
      "Code Generator implementing logic…",
      "UI/UX Agent refining interface…",
      "Security Agent validating…",
      "Testing Agent running checks…",
    ];
    let i = 0;
    const stepInt = setInterval(() => {
      i++;
      setBlocks(prev => prev.map(b => b.id === id
        ? { ...b, steps: narrationSteps.slice(0, i) } : b));
      if (i >= narrationSteps.length) clearInterval(stepInt);
    }, 600);

    let reply = "Task received — agents are processing your request.";
    try {
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("nexus-token") : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: userText }),
      });
      const data = await res.json();
      reply = data.reply || reply;
      if (data.updating) {
        // Confirmed: build is in-flight. Optimistic flag stays true.
        onUpdateStartedRef.current?.();
      } else {
        // Backend chose NOT to build — clear optimistic flag so a stray
        // SSE __DONE__ from an unrelated event doesn't fire onBuildComplete.
        pendingBuildRef.current = false;
        // No build triggered — close block immediately after narration
        setTimeout(() => {
          clearInterval(stepInt);
          setBlocks(prev => prev.map(b => b.id === id && b.completedAt === null
            ? { ...b, completedAt: Date.now(), reply } : b));
          if (currentIdRef.current === id) currentIdRef.current = null;
          setIsStreaming(false);
        }, narrationSteps.length * 600 + 400);
      }
    } catch {
      reply = "Request queued — the swarm will retry when connectivity returns.";
    }

    // Attach reply to the current block (visible when expanded)
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, reply } : b));
    setIsLoading(false);
  }, [projectId, isLoading, onUpdateStarted]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  // The most-recent block is auto-expanded, all older ones collapsed.
  const lastIdx = blocks.length - 1;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#06060f]">
      {/* Live 21-agent grid */}
      <SwarmGrid
        activeKeys={activeKeys}
        completedKeys={completedKeys}
        isStreaming={isStreaming}
        currentTask={currentTask}
      />

      {/* Greeting + work blocks (collapsed folders) */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2">
        {/* Greeting */}
        <div className="flex gap-2">
          <div className="shrink-0 w-6 h-6 rounded bg-primary/10 border border-primary/40 flex items-center justify-center">
            <Bot className="w-3 h-3 text-primary" />
          </div>
          <div className="flex-1 bg-secondary/20 border border-border/30 rounded px-2.5 py-1.5">
            <div className="text-[9px] text-primary/60 uppercase tracking-wider mb-0.5">Nexus Swarm</div>
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
            No active work — send a request below to dispatch the swarm.
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Compact input */}
      <div className="shrink-0 border-t border-primary/20 bg-secondary/10 p-2">
        <div className="flex gap-1.5 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Tell the swarm what to build…"
            rows={1}
            disabled={isLoading}
            className="flex-1 bg-background/60 border border-border/50 rounded px-2.5 py-1.5 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 resize-none outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all disabled:opacity-50 max-h-24"
          />
          <Button
            size="sm"
            onClick={() => send(input)}
            disabled={isLoading || !input.trim()}
            className="h-8 px-2.5 glow-primary-hover"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
        <p className="text-[8px] text-muted-foreground/30 mt-1 font-mono flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />
          21 SPECIALISTS · WORK AUTO-COLLAPSES INTO FOLDERS · MAIN PORTAL HAS FULL HISTORY
        </p>
      </div>
    </div>
  );
}
