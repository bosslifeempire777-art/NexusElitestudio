/**
 * GenesisSwarmDiagram — live animated visualization of the Genesis Swarm
 * during a project build. Parses __SWARM__:{...} events from the SSE log
 * stream and animates the 5-layer architecture in real-time.
 */
import { useEffect, useMemo, useState } from "react";

// ── Swarm event types (mirrors genesisSwarm.ts) ──────────────
type SwarmEventType =
  | "concierge"
  | "orchestrate"
  | "agent_start"
  | "agent_done"
  | "guardian_start"
  | "guardian_repair"
  | "guardian_done"
  | "gateway"
  | "progress"
  | "build_complete";

interface SwarmEvent { type: SwarmEventType; [k: string]: any; }

type NodeState = "idle" | "active" | "done" | "error";
type LayerState = "idle" | "active" | "done";

interface DiagramState {
  layer1: LayerState;   conciergeModel: string;   conciergeAction: string;
  layer2: LayerState;   orchestrateModel: string; taskCount: number;
  layer3: LayerState;   swarmTier: string;
  agentStates: Record<string, NodeState>;
  agentModels: Record<string, string>;
  agentTasks:  Record<string, string>;
  guardianState: NodeState;  guardianPassed: number; guardianRepaired: number;
  layer4: LayerState;   activeModels: string[];
  progress: number;
  lastActivity: string;
  complete: boolean;
}

const INIT: DiagramState = {
  layer1: "idle", conciergeModel: "", conciergeAction: "",
  layer2: "idle", orchestrateModel: "", taskCount: 0,
  layer3: "idle", swarmTier: "cost",
  agentStates: {
    PLANNER: "idle", BACKEND_CODER: "idle", FRONTEND_CODER: "idle",
    UI_UX_DESIGNER: "idle", GAME_LOGIC: "idle", REVIEWER: "idle",
    TROUBLESHOOTER: "idle", ESCALATION: "idle",
  },
  agentModels: {},
  agentTasks: {},
  guardianState: "idle", guardianPassed: 0, guardianRepaired: 0,
  layer4: "idle", activeModels: [],
  progress: 0,
  lastActivity: "Initialising swarm…",
  complete: false,
};

const ROLE_LABELS: Record<string, string> = {
  PLANNER:        "🏗 Planner",
  BACKEND_CODER:  "⚙️ Backend",
  FRONTEND_CODER: "🖥 Frontend",
  UI_UX_DESIGNER: "🎨 UI/UX",
  GAME_LOGIC:     "🎮 Game",
  REVIEWER:       "🔍 Reviewer",
  TROUBLESHOOTER: "🔧 Debug",
  ESCALATION:     "⬆ Escalate",
};

function shortModel(m: string) {
  if (!m) return "";
  if (m.includes("deepseek-chat"))  return "deepseek";
  if (m.includes("gemini-2.5-pro")) return "gemini-pro";
  if (m.includes("gemini-2.5-flash")) return "gemini-flash";
  if (m.includes("claude-sonnet")) return "claude-sonnet";
  if (m.includes("claude-opus"))   return "claude-opus";
  if (m.includes("gpt-4o-mini"))   return "gpt-4o-mini";
  if (m.includes("gpt-4o"))        return "gpt-4o";
  if (m.includes("qwen3-coder"))   return "qwen-coder";
  if (m.includes("llama"))         return "llama-3.3";
  return m.split("/").pop()?.slice(0, 14) ?? m.slice(0, 14);
}

function parseEvents(logs: string[]): SwarmEvent[] {
  const events: SwarmEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("__SWARM__:")) continue;
    try {
      events.push(JSON.parse(line.slice("__SWARM__:".length)) as SwarmEvent);
    } catch { /* skip malformed */ }
  }
  return events;
}

function applyEvents(events: SwarmEvent[], base: DiagramState): DiagramState {
  let s = { ...base, agentStates: { ...base.agentStates }, agentModels: { ...base.agentModels }, agentTasks: { ...base.agentTasks }, activeModels: [...base.activeModels] };

  for (const ev of events) {
    switch (ev.type) {
      case "concierge":
        s.layer1 = "active";
        s.conciergeModel = ev.model ?? "";
        s.conciergeAction = ev.tier ? `Routing → ${ev.tier} tier` : "Classifying intent";
        s.layer4 = "active";
        if (ev.model && !s.activeModels.includes(shortModel(ev.model))) {
          s.activeModels = [...s.activeModels, shortModel(ev.model)].slice(-6);
        }
        s.lastActivity = `Concierge routing request via ${shortModel(ev.model)}`;
        break;

      case "orchestrate":
        s.layer1 = "done";
        s.layer2 = "active";
        s.orchestrateModel = ev.model ?? "";
        s.taskCount = ev.tasks ?? 0;
        s.agentStates = { ...s.agentStates, PLANNER: "active" };
        s.agentModels = { ...s.agentModels, PLANNER: ev.model ?? "" };
        s.lastActivity = `Decomposed into ${ev.tasks} tasks`;
        if (ev.model) s.activeModels = [...new Set([...s.activeModels, shortModel(ev.model)])].slice(-6);
        break;

      case "agent_start": {
        const role = ev.role as string;
        s.layer2 = "done";
        s.layer3 = "active";
        s.swarmTier = ev.swarm ?? "cost";
        s.agentStates = { ...s.agentStates, [role]: "active" };
        s.agentModels = { ...s.agentModels, [role]: ev.model ?? "" };
        s.agentTasks  = { ...s.agentTasks,  [role]: ev.task  ?? "" };
        if (ev.model) s.activeModels = [...new Set([...s.activeModels, shortModel(ev.model)])].slice(-6);
        s.lastActivity = `${ROLE_LABELS[role] ?? role} → ${(ev.task ?? "").slice(0, 50)}`;
        s.layer4 = "active";
        break;
      }

      case "agent_done": {
        const role = ev.role as string;
        s.agentStates = { ...s.agentStates, [role]: "done" };
        break;
      }

      case "guardian_start":
        s.guardianState = "active";
        s.lastActivity  = `Guardian reviewing ${ev.artifacts} files…`;
        break;

      case "guardian_repair":
        s.guardianState = "active";
        s.lastActivity  = `Guardian repairing ${ev.path}`;
        break;

      case "guardian_done":
        s.guardianState     = "done";
        s.guardianPassed    = ev.passed   ?? 0;
        s.guardianRepaired  = ev.repaired ?? 0;
        s.lastActivity      = `Guardian: ✅ ${ev.passed} passed, 🔧 ${ev.repaired} repaired`;
        break;

      case "progress":
        s.progress = ev.pct ?? s.progress;
        break;

      case "build_complete":
        s.layer1 = "done"; s.layer2 = "done"; s.layer3 = "done"; s.layer4 = "done";
        s.guardianState = "done";
        s.progress = 100;
        s.complete = true;
        s.lastActivity = `Build complete — ${ev.files} files, ${ev.calls} LLM calls`;
        for (const k of Object.keys(s.agentStates)) {
          if (s.agentStates[k] === "active") s.agentStates[k] = "done";
        }
        break;
    }
  }
  return s;
}

// ── Animation class helpers ──
function layerCls(state: LayerState) {
  if (state === "active") return "border-primary/80 bg-primary/10 shadow-[0_0_12px_rgba(0,212,255,0.2)]";
  if (state === "done")   return "border-green-500/60 bg-green-500/8";
  return "border-border/30 bg-background/30";
}

function nodeCls(state: NodeState) {
  if (state === "active") return "bg-primary/20 border-primary text-primary animate-pulse shadow-[0_0_8px_rgba(0,212,255,0.4)]";
  if (state === "done")   return "bg-green-500/15 border-green-500/70 text-green-400";
  return "bg-background/40 border-border/40 text-muted-foreground/60";
}

function layerDot(state: LayerState) {
  if (state === "active") return "bg-primary animate-pulse";
  if (state === "done")   return "bg-green-500";
  return "bg-border/50";
}

// ── Main component ────────────────────────────────────────────
interface Props {
  /** Pass pre-collected SSE log lines (from AgentTerminal context). */
  logs?: string[];
  /**
   * If provided, the component subscribes directly to the project's
   * build-stream SSE endpoint and drives itself.
   */
  projectId?: string;
  isBuilding?: boolean;
  prompt?: string;
}

export default function GenesisSwarmDiagram({ logs: externalLogs, projectId, isBuilding = true, prompt }: Props) {
  const [streamedLogs, setStreamedLogs] = useState<string[]>([]);

  // Self-subscribe to SSE when projectId is given and we don't have external logs
  useEffect(() => {
    if (!projectId || (externalLogs && externalLogs.length > 0)) return;
    setStreamedLogs([]);

    const es = new EventSource(`/api/projects/${projectId}/build-stream`);
    es.onmessage = (e) => {
      try {
        const { msg } = JSON.parse(e.data) as { msg: string };
        if (msg === "__DONE__") { es.close(); return; }
        if (msg.startsWith("__REPLY__:")) return;
        setStreamedLogs(prev => [...prev, msg]);
      } catch { /* ignore */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [projectId]);

  const logs   = externalLogs && externalLogs.length > 0 ? externalLogs : streamedLogs;
  const events = useMemo(() => parseEvents(logs), [logs]);
  const state  = useMemo(() => applyEvents(events, INIT), [events]);

  // Animate progress bar smoothly
  const [displayPct, setDisplayPct] = useState(0);
  useEffect(() => {
    const target = state.progress;
    if (target <= displayPct) return;
    const id = setInterval(() => {
      setDisplayPct(p => {
        const next = Math.min(p + 1, target);
        if (next >= target) clearInterval(id);
        return next;
      });
    }, 18);
    return () => clearInterval(id);
  }, [state.progress]);

  const COST_ROLES  = ["PLANNER", "BACKEND_CODER", "FRONTEND_CODER", "UI_UX_DESIGNER", "GAME_LOGIC"];
  const GUARD_ROLES = ["REVIEWER", "TROUBLESHOOTER", "ESCALATION"];

  const flowLineCls = (active: boolean) =>
    `absolute left-1/2 -translate-x-1/2 w-0.5 ${active ? "bg-primary/60" : "bg-border/30"}`;

  return (
    <div className="flex-1 flex flex-col w-full h-full bg-[#06060f] overflow-y-auto p-3 gap-0 font-mono">

      {/* ── Header: progress bar ── */}
      <div className="shrink-0 mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-primary font-semibold tracking-widest uppercase flex items-center gap-1.5">
            {isBuilding && !state.complete
              ? <><span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />Genesis Swarm Active</>
              : <><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Build Complete</>
            }
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{displayPct}%</span>
        </div>
        <div className="h-1 w-full bg-border/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all duration-300"
            style={{ width: `${displayPct}%` }}
          />
        </div>
        {/* Active models pill strip */}
        {state.activeModels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {state.activeModels.map(m => (
              <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 border border-primary/20">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Architecture layers ── */}
      <div className="flex-1 flex flex-col items-center gap-0 w-full max-w-md mx-auto min-w-0">

        {/* ── Layer 0: User ── */}
        <div className="w-full rounded-lg border border-border/25 bg-background/20 px-3 py-2 text-center shrink-0">
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-0.5">User Request</div>
          <div className="text-xs text-muted-foreground truncate">{prompt ? `"${prompt.slice(0, 60)}"` : "Building your application…"}</div>
        </div>

        {/* connector */}
        <div className="relative h-5 w-full flex justify-center shrink-0">
          <div className={`w-0.5 h-full ${state.layer1 !== "idle" ? "bg-primary/50" : "bg-border/30"}`} />
          <div className={`absolute bottom-0 w-1.5 h-1.5 rounded-full -translate-x-1/2 left-1/2 ${state.layer1 !== "idle" ? "bg-primary" : "bg-border/40"}`} />
        </div>

        {/* ── Layer 1: Concierge ── */}
        <div className={`w-full rounded-lg border px-3 py-2 shrink-0 transition-all duration-500 ${layerCls(state.layer1)}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${layerDot(state.layer1)}`} />
              <span className="text-[11px] font-semibold text-foreground/90">🎩 Concierge Agent</span>
            </div>
            {state.conciergeModel && (
              <span className="text-[9px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                {shortModel(state.conciergeModel)}
              </span>
            )}
          </div>
          {state.conciergeAction && (
            <div className="text-[10px] text-muted-foreground mt-0.5 ml-3">{state.conciergeAction}</div>
          )}
        </div>

        {/* connector */}
        <div className="relative h-5 w-full flex justify-center shrink-0">
          <div className={`w-0.5 h-full ${state.layer2 !== "idle" ? "bg-primary/50" : "bg-border/30"}`} />
          <div className={`absolute bottom-0 w-1.5 h-1.5 rounded-full -translate-x-1/2 left-1/2 ${state.layer2 !== "idle" ? "bg-primary" : "bg-border/40"}`} />
        </div>

        {/* ── Layer 2: Orchestration ── */}
        <div className={`w-full rounded-lg border px-3 py-2 shrink-0 transition-all duration-500 ${layerCls(state.layer2)}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${layerDot(state.layer2)}`} />
              <span className="text-[11px] font-semibold text-foreground/90">🏛 Orchestration</span>
            </div>
            {state.orchestrateModel && (
              <span className="text-[9px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                {shortModel(state.orchestrateModel)}
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 ml-3">
            {state.taskCount > 0
              ? `Task Decomposer → ${state.taskCount} micro-tasks`
              : "Planner + Architect Council"}
          </div>
          {/* PLANNER node */}
          {state.agentStates.PLANNER !== "idle" && (
            <div className={`mt-1.5 ml-3 inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border ${nodeCls(state.agentStates.PLANNER)}`}>
              🏗 PLANNER
              {state.agentTasks.PLANNER && <span className="text-[8px] opacity-70 truncate max-w-[90px]">{state.agentTasks.PLANNER}</span>}
            </div>
          )}
        </div>

        {/* ── Fork connector to swarms ── */}
        <div className="relative h-5 w-full flex justify-center shrink-0">
          <div className={`w-0.5 h-full ${state.layer3 !== "idle" ? "bg-primary/50" : "bg-border/30"}`} />
        </div>

        {/* ── Layer 3: Swarm Execution + Guardian ── */}
        <div className="w-full flex gap-2 shrink-0">

          {/* Cost / Premium Swarm */}
          <div className={`flex-1 rounded-lg border px-2.5 py-2 transition-all duration-500 ${layerCls(state.layer3)}`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${layerDot(state.layer3)}`} />
              <span className="text-[10px] font-semibold text-foreground/90 capitalize">
                {state.swarmTier === "premium" ? "⚡ Premium" : "💰 Cost"} Swarm
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {COST_ROLES.map(role => (
                <div
                  key={role}
                  className={`flex items-center justify-between text-[9px] px-1.5 py-0.5 rounded border transition-all duration-300 ${nodeCls(state.agentStates[role])}`}
                >
                  <span className="truncate">{ROLE_LABELS[role] ?? role}</span>
                  {state.agentStates[role] === "active" && state.agentModels[role] && (
                    <span className="opacity-60 shrink-0 ml-1">{shortModel(state.agentModels[role])}</span>
                  )}
                  {state.agentStates[role] === "done" && <span className="text-green-400 shrink-0">✓</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Guardian Swarm */}
          <div className={`w-28 rounded-lg border px-2 py-2 transition-all duration-500 ${
            state.guardianState !== "idle"
              ? state.guardianState === "done"
                ? "border-green-500/60 bg-green-500/8"
                : "border-amber-500/60 bg-amber-500/8 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
              : "border-border/30 bg-background/30"
          }`}>
            <div className="flex items-center gap-1 mb-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                state.guardianState === "active" ? "bg-amber-400 animate-pulse" :
                state.guardianState === "done"   ? "bg-green-500" : "bg-border/50"
              }`} />
              <span className="text-[10px] font-semibold text-foreground/90">🛡 Guardian</span>
            </div>
            <div className="flex flex-col gap-1">
              {GUARD_ROLES.map(role => (
                <div
                  key={role}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-all duration-300 ${nodeCls(state.agentStates[role])}`}
                >
                  <span className="truncate block">{ROLE_LABELS[role] ?? role}</span>
                </div>
              ))}
            </div>
            {(state.guardianPassed > 0 || state.guardianRepaired > 0) && (
              <div className="mt-1.5 text-[8px] text-muted-foreground/70 leading-tight">
                <div className="text-green-400/80">✅ {state.guardianPassed} ok</div>
                {state.guardianRepaired > 0 && <div className="text-amber-400/80">🔧 {state.guardianRepaired} fixed</div>}
              </div>
            )}
          </div>
        </div>

        {/* connector */}
        <div className="relative h-5 w-full flex justify-center shrink-0">
          <div className={`w-0.5 h-full ${state.layer4 !== "idle" ? "bg-primary/50" : "bg-border/30"}`} />
          <div className={`absolute bottom-0 w-1.5 h-1.5 rounded-full -translate-x-1/2 left-1/2 ${state.layer4 !== "idle" ? "bg-primary" : "bg-border/40"}`} />
        </div>

        {/* ── Layer 4: OpenRouter Gateway ── */}
        <div className={`w-full rounded-lg border px-3 py-2 shrink-0 transition-all duration-500 ${layerCls(state.layer4)}`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${layerDot(state.layer4)}`} />
            <span className="text-[11px] font-semibold text-foreground/90">🌐 OpenRouter Gateway</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(state.activeModels.length > 0 ? state.activeModels : ["deepseek", "gemini-flash", "gpt-4o-mini"]).map(m => (
              <span
                key={m}
                className={`text-[9px] px-1.5 py-0.5 rounded border transition-all duration-300 ${
                  state.layer4 === "active"
                    ? "bg-primary/15 border-primary/40 text-primary/80 animate-pulse"
                    : state.layer4 === "done"
                      ? "bg-green-500/10 border-green-500/30 text-green-400/70"
                      : "bg-background/40 border-border/40 text-muted-foreground/60"
                }`}
              >
                {m}
              </span>
            ))}
          </div>
        </div>

      </div>

      {/* ── Activity ticker ── */}
      <div className="shrink-0 mt-3 text-[10px] font-mono text-muted-foreground/70 bg-black/20 rounded border border-border/20 px-3 py-1.5 truncate">
        <span className="text-primary/60 mr-1.5">▶</span>
        {state.lastActivity}
      </div>

      {/* ── Recent raw logs (last 4) ── */}
      <div className="shrink-0 mt-2 space-y-0.5">
        {logs
          .filter(l => !l.startsWith("__SWARM__:") && l.trim())
          .slice(-4)
          .map((log, i) => {
            const agent = log.match(/\[([^\]]+)\]/)?.[1] ?? "";
            const body  = log.replace(/\[[^\]]+\]\s?/, "");
            const isOk  = log.includes("✅") || log.includes("🎉");
            const isErr = log.includes("❌") || log.toLowerCase().includes("error");
            return (
              <div key={i} className={`flex items-start gap-2 text-[10px] font-mono ${isErr ? "text-red-400/80" : isOk ? "text-green-400/80" : "text-muted-foreground/50"}`}>
                {agent && <span className="shrink-0 text-primary/50 min-w-[80px] truncate">[{agent}]</span>}
                <span className="flex-1 truncate">{body}</span>
              </div>
            );
          })}
      </div>

    </div>
  );
}
