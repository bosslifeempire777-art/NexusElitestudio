/**
 * artifacts/ai-studio/src/pages/agents.tsx
 *
 * HYDRA-PRIME v4 — Live Swarm Command Center
 * Replaces the old static agent card grid with a fully-live
 * 7-layer swarm visualization. Each agent cell lights up,
 * pulses, and shows real-time activity text while building.
 *
 * Connects to POST /api/agents/hydra/build (SSE) for live logs.
 * Falls back to a simulated demo mode with no backend running.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  Crown, GitBranch, Layers, Zap, Bug, Shield, Eye,
  Dna, CheckCircle2, Send, Loader2, Terminal, Activity,
  Cpu, BarChart3, FileCode, Clock, ChevronDown, ChevronUp,
  Flame, Radio,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   AGENT DEFINITIONS — 7 layers, 24 agents
   ───────────────────────────────────────────────────────────── */

interface HydraAgent {
  key:         string;
  name:        string;
  short:       string;
  icon:        string;
  layer:       number;
  color:       string;   // tailwind color name
  description: string;  // what this agent does
  models:      string[]; // model tier used
}

const HYDRA_AGENTS: HydraAgent[] = [
  // ── Layer 1 ─────────────────────────────────────────────
  {
    key: "sovereign", name: "SOVEREIGN", short: "SOV", icon: "👑",
    layer: 1, color: "violet",
    description: "CEO Brain — reads your prompt, classifies project type, generates master blueprint",
    models: ["GLM-4.6", "DeepSeek-V3", "Claude Opus"],
  },
  // ── Layer 2 ─────────────────────────────────────────────
  {
    key: "sysarch", name: "System Architect", short: "SYS", icon: "🏗️",
    layer: 2, color: "blue",
    description: "Designs modules, services, and data flow from the blueprint",
    models: ["Kimi-K2", "Claude Sonnet"],
  },
  {
    key: "uxarch", name: "UX Architect", short: "UXA", icon: "🎨",
    layer: 2, color: "pink",
    description: "Designs screen flows, components, and the full design system",
    models: ["GLM-4.6", "Claude Opus"],
  },
  {
    key: "dataarch", name: "Data Architect", short: "DAT", icon: "🗄️",
    layer: 2, color: "cyan",
    description: "Designs schemas, indexes, migrations, and data APIs",
    models: ["DeepSeek-V3", "Gemini 2.5 Pro"],
  },
  {
    key: "secarch", name: "Security Architect", short: "SEC", icon: "🔐",
    layer: 2, color: "red",
    description: "Designs auth, RBAC, secrets management, and threat model",
    models: ["Claude Sonnet", "Kimi-K2"],
  },
  {
    key: "opsarch", name: "DevOps Architect", short: "OPS", icon: "⚙️",
    layer: 2, color: "slate",
    description: "Designs CI/CD pipelines, infrastructure, and monitoring",
    models: ["GLM-4.6", "DeepSeek-V3"],
  },
  // ── Layer 3 ─────────────────────────────────────────────
  {
    key: "fe", name: "Frontend", short: "FE", icon: "💻",
    layer: 3, color: "emerald",
    description: "React / Next.js / Vue / Svelte — full UI implementation",
    models: ["Qwen3-Coder", "DeepSeek-V3"],
  },
  {
    key: "be", name: "Backend", short: "BE", icon: "🔧",
    layer: 3, color: "orange",
    description: "Node / Python / Go APIs and microservices",
    models: ["Qwen3-Coder", "GLM-4.6"],
  },
  {
    key: "db", name: "Database", short: "DB", icon: "🗃️",
    layer: 3, color: "yellow",
    description: "Postgres / MongoDB / Redis — schemas, queries, and ORM",
    models: ["DeepSeek-V3", "Qwen3-Coder"],
  },
  {
    key: "mob", name: "Mobile", short: "MOB", icon: "📱",
    layer: 3, color: "blue",
    description: "iOS (Swift) and Android (Kotlin) or React Native / Expo",
    models: ["Kimi-K2", "Claude Sonnet"],
  },
  {
    key: "gme", name: "Game Engine", short: "GME", icon: "🎮",
    layer: 3, color: "purple",
    description: "Unity C# / Godot / Phaser / Three.js game implementation",
    models: ["GLM-4.6", "Claude Opus"],
  },
  {
    key: "aiml", name: "AI / ML", short: "AIM", icon: "🤖",
    layer: 3, color: "violet",
    description: "LLM integration, embeddings, RAG pipelines",
    models: ["Claude Sonnet", "Gemini 2.5 Pro"],
  },
  {
    key: "authh", name: "Auth", short: "ATH", icon: "🔑",
    layer: 3, color: "amber",
    description: "OAuth 2, JWT, sessions, and RBAC implementation",
    models: ["DeepSeek-V3", "GLM-4.6"],
  },
  {
    key: "pay", name: "Payments", short: "PAY", icon: "💳",
    layer: 3, color: "emerald",
    description: "Stripe / IAP / subscription billing end-to-end",
    models: ["Qwen3-Coder", "Claude Sonnet"],
  },
  {
    key: "dvo", name: "DevOps", short: "DVO", icon: "🚀",
    layer: 3, color: "slate",
    description: "Docker, GitHub Actions, Render deploy, EAS build configs",
    models: ["GLM-4.6", "DeepSeek-V3"],
  },
  {
    key: "qa", name: "QA", short: "QA", icon: "🧪",
    layer: 3, color: "teal",
    description: "Jest / Playwright / Cypress — unit, integration, e2e tests",
    models: ["Qwen3-Coder", "GLM-4.6"],
  },
  {
    key: "docs", name: "Docs", short: "DOC", icon: "📚",
    layer: 3, color: "sky",
    description: "README, OpenAPI docs, user guides, changelogs",
    models: ["DeepSeek-V3", "Kimi-K2"],
  },
  // ── Layer 4 ─────────────────────────────────────────────
  {
    key: "worker", name: "Worker Pods", short: "WRK", icon: "⚡",
    layer: 4, color: "yellow",
    description: "3–10 cheap fast workers per department executing atomic tasks in parallel",
    models: ["GLM-4.6", "MiMo", "Ling-Mini"],
  },
  {
    key: "fractal", name: "Fractal Sub-swarm", short: "FRC", icon: "🔀",
    layer: 4, color: "cyan",
    description: "Recursively spawns micro-task sub-swarms up to depth 4 (Kimi-K2 style)",
    models: ["GLM-4.6", "DeepSeek-V3"],
  },
  // ── Layer 5 ─────────────────────────────────────────────
  {
    key: "bughunt", name: "Bug Hunter", short: "BUG", icon: "🐛",
    layer: 5, color: "red",
    description: "Adversarial review — hunts bugs, edge cases, and runtime errors",
    models: ["DeepSeek-V3", "GLM-4.6"],
  },
  {
    key: "secaudit", name: "Sec Auditor", short: "AUD", icon: "🛡️",
    layer: 5, color: "red",
    description: "Adversarial review — hunts injection, XSS, auth flaws, secret leaks",
    models: ["Claude Sonnet", "DeepSeek-V3"],
  },
  {
    key: "uxcrit", name: "UX Critic", short: "UXC", icon: "👁️",
    layer: 5, color: "pink",
    description: "Adversarial review — hunts UX problems and accessibility issues",
    models: ["GLM-4.6", "Claude Opus"],
  },
  // ── Layer 6 ─────────────────────────────────────────────
  {
    key: "synth", name: "Synthesizer", short: "SYN", icon: "🧬",
    layer: 6, color: "violet",
    description: "Merges all artifacts, resolves conflicts, produces the final file tree",
    models: ["Gemini 2.5 Pro", "Kimi-K2"],
  },
  // ── Layer 7 ─────────────────────────────────────────────
  {
    key: "valid", name: "Validator", short: "VAL", icon: "✅",
    layer: 7, color: "emerald",
    description: "Static analysis, README, .env.example, Dockerfile, BUILD_REPORT.json",
    models: ["GLM-4.6", "DeepSeek-V3"],
  },
];

/* ─────────────────────────────────────────────────────────────
   LAYER META
   ───────────────────────────────────────────────────────────── */
const LAYER_META = [
  { layer: 1, label: "SOVEREIGN",         sublabel: "CEO Brain",              icon: Crown,        accent: "violet" },
  { layer: 2, label: "ARCHITECT COUNCIL", sublabel: "5 Specialists · Parallel", icon: GitBranch,  accent: "blue"   },
  { layer: 3, label: "DEPARTMENT HEADS",  sublabel: "11 Domains · Decompose",   icon: Layers,     accent: "emerald"},
  { layer: 4, label: "FRACTAL WORKERS",   sublabel: "Up to 200 · Recursive",    icon: Zap,        accent: "yellow" },
  { layer: 5, label: "CRITIC RING",       sublabel: "3 Adversarial Reviewers",  icon: Bug,        accent: "red"    },
  { layer: 6, label: "SYNTHESIZER",       sublabel: "Conflict Resolution",       icon: Dna,        accent: "violet" },
    { layer: 7, label: "VALIDATOR",         sublabel: "Package & Ship",            icon: CheckCircle2, accent: "emerald"},
  ];

  /* ─────────────────────────────────────────────────────────────
     AGENT MATCHER (same as SwarmTerminal)
     ───────────────────────────────────────────────────────────── */
  function matchAgent(text: string): string | null {
    const t = text.toLowerCase();
    if (t.includes("sovereign"))                                     return "sovereign";
    if (t.includes("systemarchitect") || t.includes("sys arch"))    return "sysarch";
    if (t.includes("uxarchitect")     || t.includes("ux arch"))     return "uxarch";
    if (t.includes("dataarchitect")   || t.includes("data arch"))   return "dataarch";
    if (t.includes("securityarchitect")|| t.includes("sec arch"))   return "secarch";
    if (t.includes("devopsarchitect") || t.includes("ops arch"))    return "opsarch";
    if (t.includes("frontend head")   || t.includes("frontend-w"))  return "fe";
    if (t.includes("backend head")    || t.includes("backend-w"))   return "be";
    if (t.includes("database head")   || t.includes("database-w"))  return "db";
    if (t.includes("mobileios") || t.includes("mobileandroid") || t.includes("mobile head")) return "mob";
    if (t.includes("gameengine"))                                    return "gme";
    if (t.includes("aiml") || t.includes("ai/ml"))                  return "aiml";
    if (t.includes("auth head")       || t.includes("auth-w"))      return "authh";
    if (t.includes("payments head")   || t.includes("payments-w"))  return "pay";
    if (t.includes("devops head")     || t.includes("devops-w"))    return "dvo";
    if (t.includes("qa head")         || t.includes("qa-w"))        return "qa";
    if (t.includes("docs head")       || t.includes("docs-w"))      return "docs";
    if (t.includes("splitter") || t.includes("fractal"))            return "fractal";
    if (t.includes("-w-")      || t.includes("worker pod"))         return "worker";
    if (t.includes("bughunter") || t.includes("bug hunt"))          return "bughunt";
    if (t.includes("securityauditor") || t.includes("sec audit"))   return "secaudit";
    if (t.includes("uxcritic") || t.includes("ux critic"))          return "uxcrit";
    if (t.includes("synthesizer") || t.includes("synth"))           return "synth";
    if (t.includes("validator") || t.includes("packag"))            return "valid";
    if (t.includes("orchestrat") || t.includes("sovereign"))        return "sovereign";
    if (t.includes("fixer"))                                         return "bughunt";
    return null;
  }

  /* ─────────────────────────────────────────────────────────────
     COLOR HELPERS
     ───────────────────────────────────────────────────────────── */
  const COLOR_MAP: Record<string, {
    idle:   string;
    active: string;
    done:   string;
    badge:  string;
    glow:   string;
    text:   string;
  }> = {
    violet:  { idle: "border-violet-500/20 bg-violet-500/5",   active: "border-violet-400/80 bg-violet-500/20 shadow-[0_0_20px_rgba(139,92,246,0.6)]",  done: "border-violet-500/40 bg-violet-500/10",  badge: "bg-violet-500/20 text-violet-300 border-violet-500/30",  glow: "rgba(139,92,246,0.5)",  text: "text-violet-300" },
    blue:    { idle: "border-blue-500/20   bg-blue-500/5",     active: "border-blue-400/80   bg-blue-500/20   shadow-[0_0_20px_rgba(59,130,246,0.6)]",    done: "border-blue-500/40   bg-blue-500/10",    badge: "bg-blue-500/20   text-blue-300   border-blue-500/30",    glow: "rgba(59,130,246,0.5)",  text: "text-blue-300"   },
    pink:    { idle: "border-pink-500/20   bg-pink-500/5",     active: "border-pink-400/80   bg-pink-500/20   shadow-[0_0_20px_rgba(236,72,153,0.6)]",    done: "border-pink-500/40   bg-pink-500/10",    badge: "bg-pink-500/20   text-pink-300   border-pink-500/30",    glow: "rgba(236,72,153,0.5)",  text: "text-pink-300"   },
    cyan:    { idle: "border-cyan-500/20   bg-cyan-500/5",     active: "border-cyan-400/80   bg-cyan-500/20   shadow-[0_0_20px_rgba(34,211,238,0.6)]",    done: "border-cyan-500/40   bg-cyan-500/10",    badge: "bg-cyan-500/20   text-cyan-300   border-cyan-500/30",    glow: "rgba(34,211,238,0.5)",  text: "text-cyan-300"   },
    red:     { idle: "border-red-500/20    bg-red-500/5",      active: "border-red-400/80    bg-red-500/20    shadow-[0_0_20px_rgba(239,68,68,0.6)]",     done: "border-red-500/40    bg-red-500/10",     badge: "bg-red-500/20    text-red-300    border-red-500/30",     glow: "rgba(239,68,68,0.5)",   text: "text-red-300"    },
    slate:   { idle: "border-slate-500/20  bg-slate-500/5",    active: "border-slate-400/80  bg-slate-500/20  shadow-[0_0_20px_rgba(100,116,139,0.6)]",   done: "border-slate-500/40  bg-slate-500/10",   badge: "bg-slate-500/20  text-slate-300  border-slate-500/30",   glow: "rgba(100,116,139,0.5)", text: "text-slate-300"  },
    emerald: { idle: "border-emerald-500/20 bg-emerald-500/5", active: "border-emerald-400/80 bg-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.6)]",  done: "border-emerald-500/40 bg-emerald-500/10", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", glow: "rgba(52,211,153,0.5)", text: "text-emerald-300" },
    orange:  { idle: "border-orange-500/20 bg-orange-500/5",   active: "border-orange-400/80 bg-orange-500/20 shadow-[0_0_20px_rgba(251,146,60,0.6)]",    done: "border-orange-500/40 bg-orange-500/10",   badge: "bg-orange-500/20 text-orange-300 border-orange-500/30",   glow: "rgba(251,146,60,0.5)", text: "text-orange-300"  },
    yellow:  { idle: "border-yellow-500/20 bg-yellow-500/5",   active: "border-yellow-400/80 bg-yellow-500/20 shadow-[0_0_20px_rgba(234,179,8,0.6)]",     done: "border-yellow-500/40 bg-yellow-500/10",   badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",   glow: "rgba(234,179,8,0.5)",  text: "text-yellow-300"  },
    amber:   { idle: "border-amber-500/20  bg-amber-500/5",    active: "border-amber-400/80  bg-amber-500/20  shadow-[0_0_20px_rgba(245,158,11,0.6)]",    done: "border-amber-500/40  bg-amber-500/10",    badge: "bg-amber-500/20  text-amber-300  border-amber-500/30",    glow: "rgba(245,158,11,0.5)", text: "text-amber-300"   },
    purple:  { idle: "border-purple-500/20 bg-purple-500/5",   active: "border-purple-400/80 bg-purple-500/20 shadow-[0_0_20px_rgba(168,85,247,0.6)]",    done: "border-purple-500/40 bg-purple-500/10",   badge: "bg-purple-500/20 text-purple-300 border-purple-500/30",   glow: "rgba(168,85,247,0.5)", text: "text-purple-300"  },
    teal:    { idle: "border-teal-500/20   bg-teal-500/5",     active: "border-teal-400/80   bg-teal-500/20   shadow-[0_0_20px_rgba(20,184,166,0.6)]",    done: "border-teal-500/40   bg-teal-500/10",    badge: "bg-teal-500/20   text-teal-300   border-teal-500/30",    glow: "rgba(20,184,166,0.5)", text: "text-teal-300"    },
    sky:     { idle: "border-sky-500/20    bg-sky-500/5",      active: "border-sky-400/80    bg-sky-500/20    shadow-[0_0_20px_rgba(14,165,233,0.6)]",     done: "border-sky-500/40    bg-sky-500/10",     badge: "bg-sky-500/20    text-sky-300    border-sky-500/30",     glow: "rgba(14,165,233,0.5)", text: "text-sky-300"     },
  };

  function getColor(color: string) {
    return COLOR_MAP[color] ?? COLOR_MAP.cyan;
  }

  /* ─────────────────────────────────────────────────────────────
     LOG ENTRY TYPE
     ───────────────────────────────────────────────────────────── */
  interface LogEntry {
    id:        string;
    time:      string;
    agentKey:  string | null;
    agentName: string;
    message:   string;
    type:      "info" | "ok" | "error" | "layer";
  }

  interface AgentActivity {
    message:   string;
    startedAt: number;
  }

  /* ─────────────────────────────────────────────────────────────
     SINGLE AGENT CELL
     ───────────────────────────────────────────────────────────── */
  function AgentCell({
    agent,
    isActive,
    isDone,
    activity,
  }: {
    agent:    HydraAgent;
    isActive: boolean;
    isDone:   boolean;
    activity: AgentActivity | null;
  }) {
    const c     = getColor(agent.color);
    const state = isActive ? "active" : isDone ? "done" : "idle";

    return (
      <div
        className={`
          relative flex flex-col rounded-lg border p-3 transition-all duration-500 cursor-default select-none
          ${state === "active" ? `${c.active} scale-[1.03]` : ""}
          ${state === "done"   ? "border-emerald-500/40 bg-emerald-500/8 shadow-[0_0_10px_rgba(52,211,153,0.25)]" : ""}
          ${state === "idle"   ? `${c.idle} opacity-60 hover:opacity-90` : ""}
        `}
        title={agent.description}
      >
        {/* Active pulse ring */}
        {isActive && (
          <span className="absolute inset-0 rounded-lg border border-current animate-pulse opacity-40 pointer-events-none" />
        )}

        {/* Header row */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-base leading-none">{agent.icon}</span>
          <span className={`text-[10px] font-mono font-bold leading-none truncate ${
            isActive ? c.text : isDone ? "text-emerald-300" : "text-muted-foreground/60"
          }`}>
            {agent.short}
          </span>
          {/* Status indicator */}
          {isActive && (
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" />
          )}
          {isDone && (
            <span className="ml-auto text-[10px] text-emerald-400 font-bold leading-none shrink-0">✓</span>
          )}
        </div>

        {/* Agent name */}
        <div className={`text-[9px] font-mono leading-tight truncate ${
          isActive ? "text-foreground/90" : isDone ? "text-emerald-200/70" : "text-muted-foreground/40"
        }`}>
          {agent.name}
        </div>

        {/* Live activity text — only when active */}
        {isActive && activity && (
          <div className="mt-1.5 pt-1.5 border-t border-current/20">
            <p className={`text-[8px] font-mono leading-snug line-clamp-2 ${c.text} opacity-90`}>
              {activity.message}
            </p>
          </div>
        )}

        {/* Layer badge */}
        <div className={`absolute -top-2 -right-1.5 text-[7px] font-mono font-bold px-1 py-0.5 rounded border ${c.badge}`}>
          L{agent.layer}
        </div>
      </div>
    );
  }

  /* ─────────────────────────────────────────────────────────────
     LAYER ROW
     ───────────────────────────────────────────────────────────── */
  function LayerRow({
    meta,
    agents,
    activeAgents,
    doneAgents,
    activities,
    isCurrentLayer,
  }: {
    meta:           typeof LAYER_META[number];
    agents:         HydraAgent[];
    activeAgents:   Set<string>;
    doneAgents:     Set<string>;
    activities:     Map<string, AgentActivity>;
    isCurrentLayer: boolean;
  }) {
    const Icon    = meta.icon;
    const anyDone = agents.some(a => doneAgents.has(a.key));
    const anyActive = agents.some(a => activeAgents.has(a.key));

    const accentClasses: Record<string, string> = {
      violet:  "text-violet-400  border-violet-500/30  bg-violet-500/5",
      blue:    "text-blue-400    border-blue-500/30    bg-blue-500/5",
      emerald: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
      yellow:  "text-yellow-400  border-yellow-500/30  bg-yellow-500/5",
      red:     "text-red-400     border-red-500/30     bg-red-500/5",
    };
    const ac = accentClasses[meta.accent] ?? accentClasses.blue;

    return (
      <div className={`relative rounded-xl border transition-all duration-500 overflow-hidden ${
        isCurrentLayer
          ? "border-white/15 bg-white/3 shadow-[inset_0_0_40px_rgba(255,255,255,0.03)]"
          : "border-border/20 bg-background/20"
      }`}>
        {/* Layer label — left rail */}
        <div className="flex gap-3 p-3">
          <div className="flex flex-col items-center gap-1 shrink-0 w-[72px]">
            <div className={`flex items-center justify-center w-8 h-8 rounded-lg border ${ac} shrink-0`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="text-center">
              <div className={`text-[8px] font-mono font-black uppercase tracking-widest leading-tight ${
                anyActive ? ac.split(" ")[0] : "text-muted-foreground/50"
              }`}>
                L{meta.layer}
              </div>
              <div className="text-[7px] font-mono text-muted-foreground/40 leading-tight">
                {meta.sublabel}
              </div>
            </div>
            {/* Active indicator */}
            {anyActive && (
              <div className={`text-[7px] font-mono px-1 py-0.5 rounded border ${ac} animate-pulse`}>
                LIVE
              </div>
            )}
            {anyDone && !anyActive && (
              <div className="text-[7px] font-mono px-1 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                DONE
              </div>
            )}
          </div>

          {/* Agent grid */}
          <div className={`flex-1 grid gap-2 ${
            agents.length === 1 ? "grid-cols-1 max-w-xs" :
            agents.length <= 3  ? "grid-cols-3" :
            agents.length <= 5  ? "grid-cols-5" :
            "grid-cols-4 sm:grid-cols-6 lg:grid-cols-11"
          }`}>
            {agents.map(a => (
              <AgentCell
                key={a.key}
                agent={a}
                isActive={activeAgents.has(a.key)}
                isDone={doneAgents.has(a.key)}
                activity={activities.get(a.key) ?? null}
              />
            ))}
          </div>
        </div>

        {/* Bottom status bar — shows when layer is active */}
        {isCurrentLayer && (
          <div className="px-3 pb-2">
            <div className={`text-[9px] font-mono ${ac.split(" ")[0]} opacity-80 flex items-center gap-1.5`}>
              <Radio className="w-2.5 h-2.5 animate-pulse" />
              {meta.label} — {meta.sublabel}
            </div>
          </div>      
        )}
            </div>
          );
        }

        /* ─────────────────────────────────────────────────────────────
           FLOW ARROW between layers
           ───────────────────────────────────────────────────────────── */
        function FlowArrow({ active }: { active: boolean }) {
          return (
            <div className="flex justify-center items-center h-5 shrink-0">
              <div className={`flex flex-col items-center gap-0.5 transition-all duration-300 ${
                active ? "opacity-100" : "opacity-20"
              }`}>
                <div className={`w-px h-3 bg-gradient-to-b ${
                  active
                    ? "from-white/60 to-white/20 animate-pulse"
                    : "from-muted-foreground/30 to-transparent"
                }`} />
                <ChevronDown className={`w-3 h-3 ${active ? "text-white/60" : "text-muted-foreground/30"}`} />
              </div>
            </div>
          );
        }

        /* ─────────────────────────────────────────────────────────────
           DEMO SIMULATION (no backend)
           ───────────────────────────────────────────────────────────── */
        const DEMO_SEQUENCE: Array<{ agentKey: string; message: string; delayMs: number }> = [
          { agentKey: "sovereign",  message: "Classifying project type → SaaS…",           delayMs: 400  },
          { agentKey: "sovereign",  message: "Generating master blueprint…",                delayMs: 1800 },
          { agentKey: "sysarch",    message: "Designing service boundaries and API contracts…", delayMs: 3200 },
          { agentKey: "uxarch",     message: "Mapping user flows and design system tokens…",  delayMs: 3200 },
          { agentKey: "dataarch",   message: "Designing Postgres schema with Drizzle ORM…",   delayMs: 3400 },
          { agentKey: "secarch",    message: "Modeling auth flow — JWT + RBAC roles…",        delayMs: 3600 },
          { agentKey: "opsarch",    message: "Designing GitHub Actions CI/CD pipeline…",      delayMs: 3800 },
          { agentKey: "fe",         message: "Building Next.js dashboard with Tailwind…",     delayMs: 6000 },
          { agentKey: "be",         message: "Writing Express API routes + middleware…",       delayMs: 6000 },
          { agentKey: "db",         message: "Generating Drizzle migrations and seed data…",  delayMs: 6200 },
          { agentKey: "authh",      message: "Implementing JWT auth + refresh tokens…",       delayMs: 6400 },
          { agentKey: "pay",        message: "Wiring Stripe Checkout + webhooks…",            delayMs: 6600 },
          { agentKey: "dvo",        message: "Writing Dockerfile + render.yaml…",            delayMs: 6800 },
          { agentKey: "qa",         message: "Writing Vitest unit tests for all routes…",    delayMs: 7000 },
          { agentKey: "docs",       message: "Generating OpenAPI spec and README…",           delayMs: 7200 },
          { agentKey: "worker",     message: "12 worker pods executing in parallel…",         delayMs: 7400 },
          { agentKey: "fractal",    message: "Fractal sub-swarm splitting large task…",       delayMs: 8000 },
          { agentKey: "bughunt",    message: "Scanning 18 files for runtime errors…",         delayMs: 10000 },
          { agentKey: "secaudit",   message: "Checking for SQL injection and XSS vectors…",   delayMs: 10000 },
          { agentKey: "uxcrit",     message: "Reviewing contrast ratios and a11y labels…",    delayMs: 10200 },
          { agentKey: "synth",      message: "Merging 23 files — resolving import conflicts…", delayMs: 12000 },
          { agentKey: "valid",      message: "Writing BUILD_REPORT.json — 23 files packaged", delayMs: 13500 },
        ];

        /* ─────────────────────────────────────────────────────────────
           MAIN PAGE
           ───────────────────────────────────────────────────────────── */
        export default function Agents() {
          const [prompt, setPrompt]         = useState("");
          const [buildStatus, setBuildStatus] = useState<"idle" | "running" | "done" | "error">("idle");
          const [activeAgents, setActiveAgents]     = useState<Set<string>>(new Set());
          const [doneAgents, setDoneAgents]         = useState<Set<string>>(new Set());
          const [activities, setActivities]         = useState<Map<string, AgentActivity>>(new Map());
          const [currentLayer, setCurrentLayer]     = useState<number | null>(null);
          const [logEntries, setLogEntries]         = useState<LogEntry[]>([]);
          const [metrics, setMetrics]               = useState({ calls: 0, tokens: 0, files: 0, elapsed: 0 });
          const [showLog, setShowLog]               = useState(true);

          const logRef     = useRef<HTMLDivElement>(null);
          const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
          const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
          const startedAt  = useRef<number>(0);

          /* ── Metrics ticker ──────────────────────────────────── */
          useEffect(() => {
            if (buildStatus === "running") {
              startedAt.current = Date.now();
              timerRef.current = setInterval(() => {
                setMetrics(m => ({ ...m, elapsed: Math.floor((Date.now() - startedAt.current) / 1000) }));
              }, 1000);
            } else {
              if (timerRef.current) clearInterval(timerRef.current);
            }
            return () => { if (timerRef.current) clearInterval(timerRef.current); };
          }, [buildStatus]);

          /* ── Auto-scroll log ─────────────────────────────────── */
          useEffect(() => {
            logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
          }, [logEntries.length]);

          /* ── Add a log entry ─────────────────────────────────── */
          const addLog = useCallback((
            agentKey: string | null,
            agentName: string,
            message: string,
            type: LogEntry["type"] = "info",
          ) => {
            const entry: LogEntry = {
              id:        `${Date.now()}-${Math.random()}`,
              time:      new Date().toLocaleTimeString("en-US", { hour12: false }),
              agentKey,
              agentName,
              message,
              type,
            };
            setLogEntries(prev => [...prev.slice(-200), entry]);
          }, []);

          /* ── Activate an agent ───────────────────────────────── */
          const activateAgent = useCallback((key: string, message: string) => {
            const agent = HYDRA_AGENTS.find(a => a.key === key);
            if (!agent) return;

            // Update current layer
            setCurrentLayer(agent.layer);

            // Add to active set
            setActiveAgents(prev => new Set([...prev, key]));
            setActivities(prev => new Map([...prev, [key, { message, startedAt: Date.now() }]]));

            addLog(key, agent.name, message, "info");

            // Bump fake metrics
            setMetrics(m => ({
              ...m,
              calls:  m.calls  + 1,
              tokens: m.tokens + Math.floor(Math.random() * 800 + 200),
              files:  agent.layer >= 3 ? m.files + 1 : m.files,
            }));

            // After 3s, move agent to done
            setTimeout(() => {
              setActiveAgents(prev => { const n = new Set(prev); n.delete(key); return n; });
              setDoneAgents(prev => new Set([...prev, key]));
              setActivities(prev => { const n = new Map(prev); n.delete(key); return n; });
              addLog(key, agent.name, "✓ Complete", "ok");
            }, 3000);
          }, [addLog]);

          /* ── Parse a real SSE log line ───────────────────────── */
          const parseLogLine = useCallback((line: string) => {
            const agentKey = matchAgent(line);
            const agentName = agentKey
              ? (HYDRA_AGENTS.find(a => a.key === agentKey)?.name ?? "Agent")
              : "System";
            const body = line.replace(/\[[^\]]+\]\s?/, "").trim();

            if (agentKey) activateAgent(agentKey, body);
            else addLog(null, agentName, body, line.includes("✅") || line.includes("✓") ? "ok" : "info");
          }, [activateAgent, addLog]);

          /* ── Demo simulation ─────────────────────────────────── */
          const runDemo = useCallback(() => {
            setActiveAgents(new Set());
            setDoneAgents(new Set());
            setActivities(new Map());
            setCurrentLayer(null);
            setLogEntries([]);
            setMetrics({ calls: 0, tokens: 0, files: 0, elapsed: 0 });
            setBuildStatus("running");
            addLog(null, "HYDRA-PRIME", "=".repeat(40), "layer");
            addLog(null, "HYDRA-PRIME", "SWARM v4 — engaging (demo mode)", "info");

            DEMO_SEQUENCE.forEach(({ agentKey, message, delayMs }) => {
              const t = setTimeout(() => activateAgent(agentKey, message), delayMs);
              demoTimers.current.push(t);
            });

            const finishT = setTimeout(() => {
              setBuildStatus("done");
              addLog(null, "HYDRA-PRIME", "✅ BUILD COMPLETE — all 7 layers finished", "ok");
              setCurrentLayer(null);
            }, 17000);
            demoTimers.current.push(finishT);
          }, [activateAgent, addLog]);

          /* ── Real SSE build ──────────────────────────────────── */
          const runRealBuild = useCallback(async (userPrompt: string) => {
            setActiveAgents(new Set());
            setDoneAgents(new Set());
            setActivities(new Map());
            setCurrentLayer(null);
            setLogEntries([]);
            setMetrics({ calls: 0, tokens: 0, files: 0, elapsed: 0 });
            setBuildStatus("running");
            addLog(null, "HYDRA-PRIME", "SWARM v4 — engaging", "info");

            try {
              const token = typeof localStorage !== "undefined"
                ? localStorage.getItem("nexus-token") : null;

              const resp = await fetch("/api/agents/hydra/build", {
                method:  "POST",
                headers: {
                  "Content-Type":  "application/json",
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ prompt: userPrompt }),
              });

              if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

              const reader  = resp.body.getReader();
              const decoder = new TextDecoder();

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n");
                for (const line of lines) {
                  if (!line.startsWith("data: ")) continue;
                  try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.msg === "__DONE__") {
                      setBuildStatus("done");
                      setCurrentLayer(null);
                      addLog(null, "HYDRA-PRIME", "✅ BUILD COMPLETE", "ok");
                      break;
                    }
                    if (parsed.type === "complete") {
                      const result = parsed.result;
                      if (result?.metrics) {
                        setMetrics(m => ({
                          ...m,
                          calls:  result.metrics.calls ?? m.calls,
                          tokens: (result.metrics.tokensIn ?? 0) + (result.metrics.tokensOut ?? 0),
                          files:  Object.keys(result.files ?? {}).length,
                        }));
                      }
                    }
                    if (parsed.msg) parseLogLine(parsed.msg);
                  } catch {}
                }
              }
            } catch (err: any) {
              addLog(null, "HYDRA-PRIME", `Backend unavailable — ${err?.message ?? "running demo mode"}`, "error");
              runDemo();
            }
          }, [addLog, parseLogLine, runDemo]);

          /* ── Submit handler ──────────────────────────────────── */
          const handleSubmit = useCallback(() => {
            if (buildStatus === "running") return;
            demoTimers.current.forEach(clearTimeout);
            demoTimers.current = [];

            if (!prompt.trim()) {
              runDemo();      runDemo();
                  } else {
                    runRealBuild(prompt.trim());
                  }
                }, [buildStatus, prompt, runDemo, runRealBuild]);

                const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                };

                // Cleanup on unmount
                useEffect(() => () => {
                  demoTimers.current.forEach(clearTimeout);
                  if (timerRef.current) clearInterval(timerRef.current);
                }, []);

                const completedLayers = new Set(
                  HYDRA_AGENTS
                    .filter(a => doneAgents.has(a.key))
                    .map(a => a.layer)
                );

                /* ─────────────────────────────────────────────────────────
                   RENDER
                   ─────────────────────────────────────────────────────── */
                return (
                  <AppLayout>
                    <div className="max-w-[1600px] mx-auto space-y-4">

                      {/* ── HEADER ──────────────────────────────────────────── */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/30 pb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Flame className="w-5 h-5 text-violet-400" />
                            <h1 className="text-2xl font-display font-black text-glow uppercase tracking-wide">
                              HYDRA-PRIME <span className="text-violet-400">v4</span>
                            </h1>
                          </div>
                          <p className="text-xs font-mono text-muted-foreground">
                            7-layer hierarchical swarm · 24 specialists · fractal sub-swarming · adversarial critic ring
                          </p>
                        </div>

                        {/* Metrics strip */}
                        <div className="flex items-center gap-3 flex-wrap">
                          {[
                            { icon: Cpu,       label: "LLM Calls", value: metrics.calls,   color: "text-violet-400" },
                            { icon: BarChart3, label: "Tokens",    value: `${(metrics.tokens / 1000).toFixed(1)}K`, color: "text-blue-400" },
                            { icon: FileCode,  label: "Files",     value: metrics.files,   color: "text-emerald-400" },
                            { icon: Clock,     label: "Elapsed",   value: `${metrics.elapsed}s`, color: "text-yellow-400" },
                          ].map(({ icon: Icon, label, value, color }) => (
                            <div key={label} className="flex flex-col items-center border border-border/30 rounded-lg px-3 py-1.5 bg-background/40 min-w-[60px]">
                              <Icon className={`w-3.5 h-3.5 ${color} mb-0.5`} />
                              <span className={`text-sm font-mono font-bold ${color}`}>{value}</span>
                              <span className="text-[8px] font-mono text-muted-foreground/50 uppercase">{label}</span>
                            </div>
                          ))}
                          <div className={`flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1.5 rounded-lg border ${
                            buildStatus === "running" ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                            : buildStatus === "done"  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : buildStatus === "error" ? "border-red-500/40 bg-red-500/10 text-red-300"
                            : "border-border/30 bg-background/40 text-muted-foreground"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              buildStatus === "running" ? "bg-violet-400 animate-pulse"
                              : buildStatus === "done"  ? "bg-emerald-400"
                              : buildStatus === "error" ? "bg-red-400"
                              : "bg-muted-foreground"
                            }`} />
                            {buildStatus === "running" ? "SWARM ACTIVE"
                             : buildStatus === "done"  ? "BUILD COMPLETE"
                             : buildStatus === "error" ? "ERROR"
                             : "STANDBY"}
                          </div>
                        </div>
                      </div>

                      {/* ── BUILD PROMPT BAR ────────────────────────────────── */}
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <textarea
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            onKeyDown={handleKey}
                            placeholder="Describe your project — or leave blank to run a live demo build…"
                            rows={1}
                            disabled={buildStatus === "running"}
                            className="w-full bg-background/60 border border-violet-500/20 rounded-xl px-4 py-3 pr-4 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 resize-none outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all disabled:opacity-50 max-h-28"
                          />
                        </div>
                        <button
                          onClick={handleSubmit}
                          disabled={buildStatus === "running"}
                          className="flex items-center gap-2 px-5 py-3 rounded-xl font-mono font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 text-white shadow-[0_0_20px_rgba(139,92,246,0.4)] hover:shadow-[0_0_30px_rgba(139,92,246,0.6)] shrink-0"
                        >
                          {buildStatus === "running"
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> BUILDING…</>
                            : <><Send    className="w-4 h-4" /> ENGAGE SWARM</>
                          }
                        </button>
                      </div>

                      {/* ── MAIN CONTENT: Swarm diagram + Log ───────────────── */}
                      <div className="flex gap-4 items-start">

                        {/* LEFT: 7-layer diagram */}
                        <div className="flex-1 min-w-0 space-y-1">
                          {LAYER_META.map((meta, idx) => {
                            const agents        = HYDRA_AGENTS.filter(a => a.layer === meta.layer);
                            const isCurrentLayer = currentLayer === meta.layer;
                            const hasDoneBelow   = idx < LAYER_META.length - 1
                              && (currentLayer ?? 0) > meta.layer;

                            return (
                              <div key={meta.layer}>
                                <LayerRow
                                  meta={meta}
                                  agents={agents}
                                  activeAgents={activeAgents}
                                  doneAgents={doneAgents}
                                  activities={activities}
                                  isCurrentLayer={isCurrentLayer}
                                />
                                {idx < LAYER_META.length - 1 && (
                                  <FlowArrow
                                    active={
                                      isCurrentLayer ||
                                      completedLayers.has(meta.layer) ||
                                      hasDoneBelow
                                    }
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* RIGHT: Live activity log */}
                        <div className="w-[300px] xl:w-[340px] shrink-0 sticky top-4">
                          <div className="border border-border/30 rounded-xl bg-background/60 overflow-hidden">
                            {/* Log header */}
                            <div className="flex items-center justify-between px-3 py-2 border-b border-border/20 bg-secondary/20">
                              <div className="flex items-center gap-1.5">
                                <Terminal className="w-3.5 h-3.5 text-violet-400" />
                                <span className="text-[10px] font-mono font-bold text-violet-300 uppercase tracking-wider">
                                  Live Activity
                                </span>
                                {buildStatus === "running" && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                )}
                              </div>
                              <button
                                onClick={() => setShowLog(s => !s)}
                                className="text-muted-foreground/50 hover:text-foreground transition-colors"
                              >
                                {showLog
                                  ? <ChevronUp   className="w-3.5 h-3.5" />
                                  : <ChevronDown className="w-3.5 h-3.5" />
                                }
                              </button>
                            </div>

                            {showLog && (
                              <div
                                ref={logRef}
                                className="h-[480px] xl:h-[540px] overflow-y-auto p-2 space-y-0.5 font-mono text-[9px]"
                              >
                                {logEntries.length === 0 ? (
                                  <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/30">
                                    <Activity className="w-6 h-6" />
                                    <p>Engage the swarm to see live output</p>
                                  </div>
                                ) : (
                                  logEntries.map(entry => (
                                    <div
                                      key={entry.id}
                                      className={`flex gap-1.5 leading-snug px-1.5 py-1 rounded transition-colors ${
                                        entry.type === "ok"    ? "text-emerald-300/90 bg-emerald-500/5"
                                        : entry.type === "error" ? "text-red-400/90 bg-red-500/5"
                                        : entry.type === "layer" ? "text-violet-400/60"
                                        : "text-muted-foreground/70"
                                      }`}
                                    >
                                      <span className="shrink-0 text-muted-foreground/30 w-[52px]">
                                        {entry.time}
                                      </span>
                                      {entry.agentKey && (
                                        <span className={`shrink-0 w-[28px] font-bold ${
                                          HYDRA_AGENTS.find(a => a.key === entry.agentKey)
                                            ? getColor(HYDRA_AGENTS.find(a => a.key === entry.agentKey)!.color).text
                                            : "text-muted-foreground/60"
                                        }`}>
                                          {HYDRA_AGENTS.find(a => a.key === entry.agentKey)?.short ?? "SYS"}
                                        </span>
                                      )}
                                      <span className="flex-1 break-words">{entry.message}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>

                          {/* Cost tier legend */}
                          <div className="mt-3 border border-border/20 rounded-xl bg-background/40 p-3 space-y-1.5">
                            <div className="text-[9px] font-mono font-bold text-muted-foreground/50 uppercase tracking-wider mb-2">
                              Cost Tier Routing
                            </div>
                            {[
                              { tier: "T0", label: "GLM-4.6 · DeepSeek-V3 · Qwen3", pct: "80%", color: "text-emerald-400" },
                              { tier: "T1", label: "Kimi-K2 · MiniMax-M2 · Grok",   pct: "15%", color: "text-yellow-400"  },
                              { tier: "T2", label: "Claude Opus · Gemini 2.5 Pro",    pct: "5%",  color: "text-red-400"    },
                            ].map(({ tier, label, pct, color }) => (
                              <div key={tier} className="flex items-center gap-2">
                                <span className={`text-[8px] font-mono font-bold ${color} w-5`}>{tier}</span>
                                <div className="flex-1 h-1 bg-border/20 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full bg-current ${color}`}
                                    style={{ width: pct, opacity: 0.6 }}
                                  />
                                </div>
                                <span className="text-[8px] font-mono text-muted-foreground/40 w-6 text-right">{pct}</span>
                                <span className="text-[7px] font-mono text-muted-foreground/30 hidden xl:block truncate max-w-[80px]">{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </AppLayout>
                );
              }