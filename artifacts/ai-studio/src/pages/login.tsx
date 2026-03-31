import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Loader2, Shield, Eye, EyeOff } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-chart-2/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border border-primary/30 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-display text-3xl font-black tracking-wider text-foreground">
            NEXUS<span className="text-primary">ELITE</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1 font-mono">AI STUDIO ACCESS PORTAL</p>
        </div>

        <div className="bg-card/80 backdrop-blur-xl border border-border/50 rounded-lg p-8 cyber-clip">
          <h2 className="text-xl font-display font-bold mb-6 text-center">SECURE LOGIN</h2>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded text-destructive text-sm font-mono">
              ⚠ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-2 uppercase tracking-widest">
                Username or Email
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="w-full bg-background/60 border border-border/60 rounded px-4 py-3 text-sm font-mono text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all"
                placeholder="Enter username or email"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-2 uppercase tracking-widest">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-background/60 border border-border/60 rounded px-4 py-3 pr-10 text-sm font-mono text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-display font-bold tracking-wider py-3 rounded transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cyber-clip"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> AUTHENTICATING...</>
              ) : (
                "ACCESS SYSTEM"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              No account?{" "}
              <Link href="/register" className="text-primary hover:underline font-mono">
                Register here
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground/40 mt-6 font-mono">
          NEXUSELITE AI STUDIO © 2024 — BOSSLIFE EMPIRE
        </p>
      </div>
    </div>
  );
}
