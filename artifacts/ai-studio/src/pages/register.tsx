import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Loader2, UserPlus, Eye, EyeOff } from "lucide-react";

export default function Register() {
  const { register } = useAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await register(username, email, password);
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
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
      <div className="absolute top-1/4 right-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-chart-2/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border border-primary/30 mb-4">
            <UserPlus className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-display text-3xl font-black tracking-wider text-foreground">
            NEXUS<span className="text-primary">ELITE</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1 font-mono">CREATE YOUR ACCOUNT</p>
        </div>

        <div className="bg-card/80 backdrop-blur-xl border border-border/50 rounded-lg p-8 cyber-clip">
          <h2 className="text-xl font-display font-bold mb-6 text-center">JOIN THE NETWORK</h2>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded text-destructive text-sm font-mono">
              ⚠ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-2 uppercase tracking-widest">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="w-full bg-background/60 border border-border/60 rounded px-4 py-3 text-sm font-mono text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all"
                placeholder="Choose a username"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-2 uppercase tracking-widest">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-background/60 border border-border/60 rounded px-4 py-3 text-sm font-mono text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all"
                placeholder="your@email.com"
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
                  placeholder="Min. 8 characters"
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

            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-2 uppercase tracking-widest">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full bg-background/60 border border-border/60 rounded px-4 py-3 text-sm font-mono text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all"
                placeholder="Repeat password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-display font-bold tracking-wider py-3 rounded transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cyber-clip mt-2"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> CREATING ACCOUNT...</>
              ) : (
                "CREATE ACCOUNT"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline font-mono">
                Login here
              </Link>
            </p>
          </div>

          <div className="mt-4 p-3 bg-secondary/30 border border-border/30 rounded text-xs text-muted-foreground font-mono text-center">
            Free plan includes 3 projects & basic agents.<br />
            Upgrade anytime for full AI Studio access.
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground/40 mt-6 font-mono">
          NEXUSELITE AI STUDIO © 2024 — BOSSLIFE EMPIRE
        </p>
      </div>
    </div>
  );
}
