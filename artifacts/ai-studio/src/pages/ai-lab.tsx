import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/cyber-ui";
import { useEffect, useMemo, useState } from "react";
import { getToken } from "@/lib/auth";
import { useLocation } from "wouter";
import {
  Beaker, Sparkles, Send, Loader2, Coins, Zap, Trophy, Check,
  AlertCircle, ChevronDown, ChevronUp, ExternalLink, Star,
} from "lucide-react";

const API = (import.meta.env.VITE_API_URL as string | undefined) || "/api";

interface PromptPack { id: string; prompts: number; priceCents: number; label: string; perks: string }
interface ModelSpec  { slug: string; label: string; provider: string }
interface ModelResult {
  model: string; label: string; provider: string;
  ok: boolean; content: string; error?: string;
  durationMs: number; tokensIn?: number; tokensOut?: number;
}
interface RunResponse {
  runId: string; mode: string; appType: string;
  models: ModelSpec[]; responses: ModelResult[];
  durationMs: number; promptsConsumed: number;
  remaining: number; refunded?: boolean;
}
type ProviderInfo = { name: string; signupUrl: string; note: string; affiliate: boolean };

const APP_TYPES = [
  { id: "saas",       label: "SaaS / Dashboard"          },
  { id: "website",    label: "Website / Landing"         },
  { id: "ai_tool",    label: "AI Tool / Chatbot"         },
  { id: "mobile_app", label: "Mobile App"                },
  { id: "automation", label: "Automation / Backend"      },
  { id: "game",       label: "Game"                      },
];

async function api(path: string, init?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw Object.assign(new Error(err.message || res.statusText), { status: res.status, body: err });
  }
  return res.json();
}

export default function AiLab() {
  const [, setLocation] = useLocation();
  const [remaining, setRemaining]   = useState<number>(0);
  const [packs, setPacks]           = useState<PromptPack[]>([]);
  const [providers, setProviders]   = useState<Record<string, ProviderInfo>>({});
  const [appType, setAppType]       = useState<string>("saas");
  const [models, setModels]         = useState<ModelSpec[]>([]);
  const [mode, setMode]             = useState<"single" | "compare">("single");
  const [prompt, setPrompt]         = useState<string>("");
  const [running, setRunning]       = useState<boolean>(false);
  const [result, setResult]         = useState<RunResponse | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [winner, setWinner]         = useState<ModelResult | null>(null);
  const [openRecent, setOpenRecent] = useState<boolean>(false);
  const [recent, setRecent]         = useState<any[]>([]);

  // Initial load + handle ?pack=success
  useEffect(() => {
    refreshBalance();
    api("/ai-lab/providers").then(setProviders).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    if (params.get("pack") === "success") {
      const sid = params.get("session_id");
      if (sid) {
        api("/ai-lab/claim-pack", { method: "POST", body: JSON.stringify({ sessionId: sid }) })
          .then(() => { refreshBalance(); setLocation("/ai-lab", { replace: true }); })
          .catch(() => {});
      }
    }
  }, []);

  // Load model roster whenever app type changes
  useEffect(() => {
    api(`/ai-lab/models?type=${appType}`).then(d => setModels(d.models || [])).catch(() => {});
  }, [appType]);

  async function refreshBalance() {
    try {
      const data = await api("/ai-lab/balance");
      setRemaining(data.remaining ?? 0);
      setPacks(data.packs ?? []);
    } catch {}
  }

  async function loadRecent() {
    try {
      const r = await api("/ai-lab/runs?limit=10");
      setRecent(r);
    } catch {}
  }

  async function buyPack(packId: string) {
    try {
      const data = await api("/ai-lab/buy-pack", { method: "POST", body: JSON.stringify({ packId }) });
      if (data.url) window.location.href = data.url;
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function runPrompt() {
    setError(null);
    setResult(null);
    setWinner(null);
    if (!prompt.trim()) { setError("Type a prompt to test."); return; }
    setRunning(true);
    try {
      const data: RunResponse = await api("/ai-lab/run", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim(), mode, appType }),
      });
      setResult(data);
      setRemaining(data.remaining);
      if (data.refunded) setError("All models failed to respond — your prompts were refunded.");
    } catch (e: any) {
      setError(e.message);
      if (e.status === 402) await refreshBalance();
    } finally {
      setRunning(false);
    }
  }

  const cost = mode === "compare" ? 3 : 1;
  const canRun = remaining >= cost && prompt.trim().length > 0 && !running;

  const winningProvider = winner ? providers[winner.provider] : null;
  const openRouterInfo = providers["openrouter"];

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
        {/* Header + balance */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3 mb-2">
              <Beaker className="w-7 h-7 text-accent" />
              <span>AI Lab</span>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-accent/20 text-accent rounded uppercase tracking-wider">Test Drive</span>
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Test your app with the world's best AI models — GPT-4o, Claude, Gemini, Llama, Mistral, DeepSeek — and find the perfect one before subscribing directly.
            </p>
          </div>
          <div className="bg-background/60 border border-border/50 rounded-lg px-4 py-3 flex items-center gap-3 shrink-0">
            <Coins className="w-5 h-5 text-yellow-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Prompts left</div>
              <div className="text-2xl font-bold text-yellow-400 tabular-nums">{remaining.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Buy packs */}
        {remaining < 5 && (
          <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-4">
            <div className="flex items-center gap-2 text-yellow-400 font-semibold mb-3">
              <Sparkles className="w-4 h-4" />
              {remaining === 0 ? "Get started — pick a prompt pack" : "Running low — top up to keep testing"}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {packs.map(p => (
                <button
                  key={p.id}
                  onClick={() => buyPack(p.id)}
                  className="text-left border border-border/60 rounded-lg p-3 hover:border-accent hover:bg-accent/5 transition group"
                >
                  <div className="text-xs uppercase text-muted-foreground tracking-wider mb-1">{p.perks}</div>
                  <div className="text-lg font-bold text-foreground group-hover:text-accent">{p.prompts.toLocaleString()} prompts</div>
                  <div className="text-2xl font-bold text-accent">${(p.priceCents / 100).toFixed(0)}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">${(p.priceCents / 100 / p.prompts).toFixed(3)} / prompt</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Configure run */}
        <div className="border border-border/50 rounded-lg p-4 space-y-4 bg-background/40">
          {/* App type */}
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground block mb-2">What are you building?</label>
            <div className="flex flex-wrap gap-2">
              {APP_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setAppType(t.id)}
                  className={`text-xs px-3 py-1.5 rounded-md border transition ${
                    appType === t.id
                      ? "bg-accent text-background border-accent font-semibold"
                      : "bg-background/50 border-border/60 text-muted-foreground hover:text-foreground hover:border-accent/50"
                  }`}
                >{t.label}</button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground block mb-2">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode("single")}
                className={`text-left p-3 rounded-md border transition ${
                  mode === "single" ? "border-accent bg-accent/10" : "border-border/60 hover:border-accent/50"
                }`}
              >
                <div className="text-xs font-semibold flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-accent" />Auto-Pick (1 prompt)</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">We choose the single best model for your app type.</div>
              </button>
              <button
                onClick={() => setMode("compare")}
                className={`text-left p-3 rounded-md border transition ${
                  mode === "compare" ? "border-accent bg-accent/10" : "border-border/60 hover:border-accent/50"
                }`}
              >
                <div className="text-xs font-semibold flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-accent" />Side-by-Side (3 prompts)</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Run the same prompt against 3 top models and compare.</div>
              </button>
            </div>
          </div>

          {/* Models preview */}
          {models.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              {mode === "single" ? "Will run on: " : "Will run on: "}
              <span className="text-foreground font-mono">
                {(mode === "single" ? models.slice(0, 1) : models.slice(0, 3)).map(m => m.label).join(" • ")}
              </span>
            </div>
          )}

          {/* Prompt input */}
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground block mb-2">Your prompt</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder='e.g. "Write me a friendly onboarding message for a new user signing up to my fitness tracker app."'
              maxLength={4000}
              className="w-full min-h-[120px] bg-background/60 border border-border/60 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent resize-y font-mono"
            />
            <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
              <span>{prompt.length} / 4000 chars</span>
              <span>This run costs <span className="text-yellow-400 font-semibold">{cost} prompt{cost > 1 ? "s" : ""}</span></span>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <Button onClick={runPrompt} disabled={!canRun} className="w-full">
            {running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running on {mode === "single" ? "1 model" : "3 models"}…</> :
             remaining < cost ? <>Need {cost} prompts — buy a pack above</> :
             <><Send className="w-4 h-4 mr-2" />Run {mode === "single" ? "Test" : "Comparison"}</>}
          </Button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-3">
            <h2 className="text-sm font-mono uppercase tracking-wider text-accent flex items-center gap-2">
              <Check className="w-4 h-4" /> Results — {result.durationMs}ms total
            </h2>
            <div className={`grid gap-3 ${result.responses.length > 1 ? "md:grid-cols-3" : "grid-cols-1"}`}>
              {result.responses.map((r, i) => (
                <div
                  key={i}
                  className={`border rounded-lg p-3 bg-background/40 transition ${
                    winner?.model === r.model ? "border-yellow-400 shadow-lg shadow-yellow-400/10" : "border-border/60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{r.label}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{r.model}</div>
                    </div>
                    {r.ok && (
                      <button
                        onClick={() => setWinner(r)}
                        title="Pick this as the winner"
                        className={`p-1.5 rounded ${winner?.model === r.model ? "bg-yellow-400 text-background" : "text-muted-foreground hover:text-yellow-400"}`}
                      >
                        <Trophy className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {r.ok ? (
                    <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/90 max-h-[400px] overflow-auto">{r.content}</pre>
                  ) : (
                    <div className="text-xs text-red-400 italic">⚠ {r.error || "No response"}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-2 flex items-center justify-between border-t border-border/30 pt-2">
                    <span>{r.durationMs}ms</span>
                    {r.tokensOut != null && <span>{r.tokensOut} tokens out</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Graduate to direct provider */}
        {winner && winningProvider && (
          <div className="border-2 border-yellow-400/50 bg-gradient-to-br from-yellow-400/10 via-background to-accent/5 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
              <h3 className="text-base font-bold">Pick {winner.label}? Here's how to use it directly</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {/* Direct provider */}
              <a
                href={winningProvider.signupUrl}
                target="_blank" rel="noopener noreferrer"
                className="block border border-border/60 rounded-md p-3 bg-background/60 hover:border-accent transition"
              >
                <div className="text-xs uppercase text-muted-foreground tracking-wider">Sign up direct</div>
                <div className="text-base font-bold text-foreground flex items-center gap-1">
                  {winningProvider.name} <ExternalLink className="w-3.5 h-3.5" />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">{winningProvider.note}</div>
              </a>
              {/* OpenRouter aggregator */}
              {openRouterInfo && (
                <a
                  href={openRouterInfo.signupUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="block border border-accent/60 rounded-md p-3 bg-accent/5 hover:border-accent hover:bg-accent/10 transition"
                >
                  <div className="text-xs uppercase text-accent tracking-wider">Recommended — One key, all models</div>
                  <div className="text-base font-bold text-foreground flex items-center gap-1">
                    {openRouterInfo.name} <ExternalLink className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">{openRouterInfo.note}</div>
                </a>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Once you have an API key, paste it in <a href="/settings" className="text-accent underline">Settings → API Keys</a> and your built apps will use it automatically.
            </p>
          </div>
        )}

        {/* Recent runs */}
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <button
            onClick={() => { setOpenRecent(o => { if (!o) loadRecent(); return !o; }); }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-background/60 transition text-sm font-mono uppercase tracking-wider text-muted-foreground"
          >
            <span>Recent runs</span>
            {openRecent ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {openRecent && (
            <div className="border-t border-border/30 divide-y divide-border/20">
              {recent.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted-foreground">No runs yet — fire your first prompt above.</div>}
              {recent.map((r) => (
                <div key={r.id} className="px-4 py-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                    <span className="text-yellow-400">{r.promptsConsumed} prompt{r.promptsConsumed !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="text-foreground/80 truncate" title={r.prompt}>{r.prompt}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {r.mode === "compare" ? "3-model comparison" : "Auto-pick"} • {Array.isArray(r.models) ? r.models.map((m: any) => m.label).join(", ") : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
