import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Sparkles, Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({
    meta: [{ title: "Sign in — Cortex" }, { name: "description", content: "Sign in to Cortex to chat with your team about code." }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      if (redirect && redirect.startsWith("/")) {
        window.location.assign(redirect);
      } else {
        navigate({ to: "/team" });
      }
    }
  }, [user, loading, navigate, redirect]);

  async function onEmail(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setInfo(null); setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}${redirect && redirect.startsWith("/") ? redirect : "/team"}`,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        setInfo("Check your inbox to confirm your email, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grid-bg p-6">
      <div className="w-full max-w-md rounded-2xl glass-strong shadow-soft p-8">
        <Link to="/" className="flex items-center gap-2 mb-6">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display font-semibold">Cortex</span>
        </Link>
        <h1 className="text-xl font-display font-semibold mb-1">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
        <p className="text-xs text-muted-foreground mb-5">Sign in to chat with your team about code.</p>

        <form onSubmit={onEmail} className="space-y-3">
          {mode === "signup" && (
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name"
              className="w-full h-10 px-3 rounded-lg bg-input/60 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          )}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@team.com"
            className="w-full h-10 px-3 rounded-lg bg-input/60 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 6 chars)"
            className="w-full h-10 px-3 rounded-lg bg-input/60 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          {err && <p className="text-xs text-destructive">{err}</p>}
          {info && <p className="text-xs text-primary">{info}</p>}
          <button type="submit" disabled={busy}
            className="w-full h-10 rounded-lg text-sm font-medium text-primary-foreground inline-flex items-center justify-center gap-2 disabled:opacity-60 transition hover:opacity-90"
            style={{ background: "var(--gradient-primary)" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(null); setInfo(null); }}
          className="mt-4 w-full text-xs text-muted-foreground hover:text-foreground">
          {mode === "signin" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}