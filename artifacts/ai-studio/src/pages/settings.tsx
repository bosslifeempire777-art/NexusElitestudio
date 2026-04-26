import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useUpdateUser } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from "@/components/ui/cyber-ui";
import { User, Key, Shield, HardDrive, Plus, Trash2, Eye, EyeOff, Copy, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";

type SecretRow = {
  id: string;
  name: string;
  maskedValue: string;
  length: number;
  category: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type Tab = "profile" | "subscription" | "keys" | "data";

const COMMON_KEY_PRESETS = [
  { name: "OPENAI_API_KEY",     desc: "OpenAI / GPT — for AI chat & completions" },
  { name: "ANTHROPIC_API_KEY",  desc: "Anthropic / Claude" },
  { name: "STRIPE_PUBLIC_KEY",  desc: "Stripe — payments (publishable, safe for client)" },
  { name: "SENDGRID_API_KEY",   desc: "SendGrid — transactional emails" },
  { name: "TWILIO_AUTH_TOKEN",  desc: "Twilio — SMS / voice" },
  { name: "MAPBOX_TOKEN",       desc: "Mapbox — maps & geocoding" },
  { name: "OPENWEATHER_API_KEY",desc: "OpenWeather — weather data" },
];

export default function Settings() {
  const { user } = useAuth();
  const updateMutation = useUpdateUser();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("profile");

  const handleUpgrade = () => {
    if (!user) return;
    updateMutation.mutate(
      { id: user.id, data: { plan: "pro" } },
      {
        onSuccess: () => toast({ title: "System Upgraded", description: "Plan elevated to PRO tier." }),
        onError: () => toast({ title: "Error", variant: "destructive" }),
      },
    );
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="border-b border-border/50 pb-6">
          <h1 className="text-3xl font-display font-bold text-glow uppercase">System Settings</h1>
          <p className="text-muted-foreground font-mono mt-2">Configure profile, API keys, and subscription tier.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Sidebar */}
          <div className="space-y-2 font-mono text-sm">
            <SidebarBtn active={tab === "profile"} onClick={() => setTab("profile")} icon={<User className="w-4 h-4 mr-3" />}>Profile</SidebarBtn>
            <SidebarBtn active={tab === "subscription"} onClick={() => setTab("subscription")} icon={<Shield className="w-4 h-4 mr-3" />}>Subscription</SidebarBtn>
            <SidebarBtn active={tab === "keys"} onClick={() => setTab("keys")} icon={<Key className="w-4 h-4 mr-3" />}>API Keys</SidebarBtn>
            <SidebarBtn active={tab === "data"} onClick={() => setTab("data")} icon={<HardDrive className="w-4 h-4 mr-3" />}>Data Export</SidebarBtn>
          </div>

          {/* Main */}
          <div className="md:col-span-2 space-y-6">
            {tab === "profile" && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex justify-between items-center">
                      USER IDENTIFICATION
                      <Badge variant="outline" className="font-mono">{user?.plan.toUpperCase()} TIER</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-mono text-muted-foreground uppercase">Username</label>
                      <Input readOnly value={user?.username || ""} className="bg-background" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-mono text-muted-foreground uppercase">Unique Identifier</label>
                      <Input readOnly value={user?.id || ""} className="bg-background text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-destructive/30">
                  <CardHeader><CardTitle className="text-destructive">DANGER ZONE</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-sm font-mono text-muted-foreground mb-4">
                      Terminating your account will permanently destroy all constructs, source code, and assets. This action cannot be reversed.
                    </p>
                    <Button variant="destructive">Initiate Self-Destruct</Button>
                  </CardContent>
                </Card>
              </>
            )}

            {tab === "subscription" && (
              <Card className="border-accent/30">
                <CardHeader><CardTitle className="text-accent">SUBSCRIPTION STATUS</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-secondary/50 border border-border cyber-clip mb-4">
                    <div>
                      <h4 className="font-display font-bold text-lg mb-1">Current Tier: {user?.plan.toUpperCase()}</h4>
                      <p className="text-xs font-mono text-muted-foreground">
                        {user?.plan === "free" ? "Limited agent access. 5 builds remaining." : "Unlimited access enabled."}
                      </p>
                    </div>
                    {user?.plan === "free" && (
                      <Button onClick={handleUpgrade} className="mt-4 sm:mt-0 glow-accent" variant="accent">
                        Upgrade to PRO
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {tab === "keys" && <ApiKeysPanel />}

            {tab === "data" && (
              <Card>
                <CardHeader><CardTitle>DATA EXPORT</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm font-mono text-muted-foreground">
                    Data export is coming soon. For now, you can download individual project source code from each project's detail page.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function SidebarBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center p-3 cyber-clip transition-all border ${
        active
          ? "bg-primary/10 text-primary border-primary/30"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground border-transparent"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── API KEYS PANEL ─────────────────────────────────────────────────────────

function ApiKeysPanel() {
  const { toast } = useToast();
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState<Record<string, string>>({});

  function authHeaders(): Record<string, string> {
    const t = getToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  async function loadSecrets() {
    setLoading(true);
    try {
      const r = await fetch("/api/secrets", { headers: authHeaders() });
      if (r.ok) setSecrets(await r.json());
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSecrets(); }, []);

  async function addSecret() {
    if (!newName.trim() || !newValue.trim()) {
      toast({ title: "Missing fields", description: "Name and value are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/secrets", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: newName, value: newValue, description: newDesc || undefined }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast({ title: "Could not save", description: data.error || "Unknown error", variant: "destructive" });
      } else {
        toast({ title: "Secret saved", description: `${data.name} is now available to your apps.` });
        setNewName(""); setNewValue(""); setNewDesc(""); setShowAdd(false);
        loadSecrets();
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSecret(id: string, name: string) {
    if (!confirm(`Delete secret "${name}"? Apps using it will stop working until you re-add it.`)) return;
    try {
      const r = await fetch(`/api/secrets/${id}`, { method: "DELETE", headers: authHeaders() });
      if (r.ok || r.status === 204) {
        toast({ title: "Deleted", description: `${name} removed.` });
        loadSecrets();
      }
    } catch {}
  }

  async function reveal(id: string) {
    if (revealing[id]) {
      setRevealing((p) => { const n = { ...p }; delete n[id]; return n; });
      return;
    }
    try {
      const r = await fetch(`/api/secrets/reveal/${id}`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setRevealing((p) => ({ ...p, [id]: d.value }));
      }
    } catch {}
  }

  function copyValue(value: string) {
    navigator.clipboard?.writeText(value);
    toast({ title: "Copied", description: "Value copied to clipboard." });
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><Key className="w-5 h-5 text-primary" /> API KEYS / SECRETS</span>
            <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
              <Plus className="w-4 h-4 mr-1" /> Add Secret
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs font-mono text-muted-foreground mb-4 space-y-1.5 leading-relaxed">
            <p><span className="text-primary">▸</span> Save the API keys for any external services you want your generated apps to use (OpenAI, Stripe, SendGrid, weather APIs, etc.).</p>
            <p><span className="text-primary">▸</span> Each key is injected into your apps at runtime as <code className="text-accent bg-background px-1 py-0.5 rounded">window.USER_SECRETS.&lt;NAME&gt;</code>.</p>
            <p><span className="text-primary">▸</span> Only YOU can see your keys. Other users and admins cannot view their values.</p>
          </div>

          {showAdd && (
            <div className="border border-primary/40 bg-primary/5 p-4 cyber-clip mb-4 space-y-3">
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="text-[10px] font-mono uppercase text-muted-foreground self-center mr-2">Quick presets:</span>
                {COMMON_KEY_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => { setNewName(p.name); setNewDesc(p.desc); }}
                    className="text-[10px] font-mono px-2 py-1 bg-background hover:bg-primary/20 border border-border rounded transition"
                    title={p.desc}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground uppercase">Secret Name</label>
                <Input
                  placeholder="e.g. OPENAI_API_KEY"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="bg-background font-mono"
                />
                <p className="text-[10px] font-mono text-muted-foreground">Will be uppercased and underscored (e.g. "openai key" → OPENAI_KEY).</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground uppercase">Secret Value</label>
                <Input
                  type="password"
                  placeholder="paste the API key here"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="bg-background font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground uppercase">Description (optional)</label>
                <Input
                  placeholder="What this key is for"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="bg-background"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={addSecret} disabled={saving}>
                  {saving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</> : "Save Secret"}
                </Button>
                <Button variant="outline" onClick={() => setShowAdd(false)} disabled={saving}>Cancel</Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-muted-foreground font-mono text-sm">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading secrets…
            </div>
          ) : secrets.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-border/50 rounded">
              <Key className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-mono text-muted-foreground">No secrets yet.</p>
              <p className="text-xs font-mono text-muted-foreground/70 mt-1">Click "Add Secret" to save your first API key.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {secrets.map((s) => (
                <div key={s.id} className="border border-border bg-background/50 p-3 cyber-clip flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-sm text-primary">{s.name}</span>
                      <Badge variant="outline" className="text-[9px] uppercase">{s.category}</Badge>
                      <span className="text-[10px] font-mono text-muted-foreground">{s.length} chars</span>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground break-all">
                      {revealing[s.id] || s.maskedValue}
                    </div>
                    {s.description && (
                      <div className="text-[11px] text-muted-foreground/80 mt-1 italic">{s.description}</div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-1">
                    <Button size="sm" variant="outline" onClick={() => reveal(s.id)} title={revealing[s.id] ? "Hide" : "Show"}>
                      {revealing[s.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    {revealing[s.id] && (
                      <Button size="sm" variant="outline" onClick={() => copyValue(revealing[s.id])} title="Copy">
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => deleteSecret(s.id, s.name)} title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-accent">HOW IT WORKS</CardTitle></CardHeader>
        <CardContent className="text-xs font-mono text-muted-foreground space-y-2 leading-relaxed">
          <p>1. Add a secret here (e.g. <span className="text-primary">OPENAI_API_KEY</span>).</p>
          <p>2. Tell the AI builder what to add: "use OpenAI to generate text". The AI will detect the integration, wire your generated app to call the API using <code className="text-accent">window.USER_SECRETS.OPENAI_API_KEY</code>, and never hard-code the value.</p>
          <p>3. If the AI needs a key you haven't added yet, it will say so in the chat — and the live preview itself will pop a friendly overlay telling you the exact secret name to add.</p>
          <p>4. Update or rotate the key here at any time; your apps pick up the new value on next preview refresh.</p>
        </CardContent>
      </Card>
    </div>
  );
}
