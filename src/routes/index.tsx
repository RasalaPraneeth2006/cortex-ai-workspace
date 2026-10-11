import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { usePythonApi, pythonApi } from "@/hooks/usePythonApi";
import {
  GitBranch, Activity, ArrowUpRight, Bot, FileText,
  ShieldCheck, Loader2, CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Cortex" },
      { name: "description", content: "Your AI-powered developer productivity dashboard." },
    ],
  }),
  component: DashboardPage,
});

type Stats = Awaited<ReturnType<typeof pythonApi.stats.dashboard>>;

function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return `${d}d ago`;
}

function DashboardPage() {
  const { user } = useAuth();
  const { call, data: stats, loading } = usePythonApi<Stats>();

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      try {
        await call(() => pythonApi.stats.dashboard());
      }
      catch { /* not authed yet */ }
    };
    load();
    const ch = supabase.channel("dash-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [user, call]);

  const counts = stats?.counts ?? { repos: 0, docs: 0, chunks: 0, workspaceFiles: 0, aiQueries: 0 };
  const cards = [
    { label: "Repositories cached", value: counts.repos, icon: GitBranch },
    { label: "AI explanations", value: counts.docs, icon: FileText },
    { label: "Jobs run", value: counts.aiQueries, icon: Bot },
    { label: "Indexed chunks", value: counts.chunks, icon: ShieldCheck },
  ];

  return (
    <AppLayout>
      <div className="grid-bg">
        <div className="px-4 md:px-8 py-6 md:py-10 max-w-[1400px] mx-auto space-y-8">
          <section className="relative overflow-hidden rounded-2xl glass-strong shadow-soft p-6 md:p-8">
            <div className="absolute inset-0 opacity-60 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
            <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground mb-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
                  {loading ? "Loading live data…" : "Live data · realtime enabled"}
                </div>
                <h1 className="text-3xl md:text-4xl font-display font-semibold leading-tight">
                  Welcome back to <span className="gradient-text">Cortex</span>
                </h1>
                <p className="mt-2 text-sm text-muted-foreground max-w-xl">
                  Understand any codebase, generate docs, refactor with confidence, and ship faster — all from one minimalist workspace.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/repository" className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-medium text-primary-foreground transition hover:opacity-90" style={{ background: "var(--gradient-primary)" }}>
                  <GitBranch className="h-4 w-4" /> Analyze a repo
                </Link>
                <Link to="/chat" className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-border bg-secondary/60 text-sm hover:bg-secondary transition">
                  <Bot className="h-4 w-4" /> Ask Cortex
                </Link>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {cards.map((s) => (
              <div key={s.label} className="rounded-xl glass p-4 shadow-soft hover:ring-1 hover:ring-primary/30 transition">
                <div className="flex items-center justify-between">
                  <s.icon className="h-4 w-4 text-primary" />
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{loading ? "…" : "live"}</span>
                </div>
                <div className="mt-3 text-2xl font-display font-semibold tabular-nums">{s.value.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </section>

          <section className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl glass p-5 shadow-soft">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider">Recent activity</h2>
                </div>
                <Link to="/repository" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  Open repository <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
              ) : (stats?.recentJobs?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground p-3">No activity yet. Analyze a repo or explain a file to see live jobs here.</p>
              ) : (
                <ul className="space-y-2">
                  {(stats?.recentJobs ?? []).map((j) => {
                    const Icon = j.status === "done" ? CheckCircle2 : j.status === "failed" ? XCircle : j.status === "running" ? Loader2 : Clock;
                    const iconClass = j.status === "done" ? "text-primary" : j.status === "failed" ? "text-destructive" : j.status === "running" ? "text-primary animate-spin" : "text-muted-foreground";
                    return (
                      <li key={j.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 transition">
                        <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center">
                          <Icon className={`h-4 w-4 ${iconClass}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{j.message ?? j.kind.replace("_", " ")}</p>
                          <p className="text-[11px] text-muted-foreground font-mono truncate">{j.target}</p>
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(j.updated_at)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-xl glass p-5 shadow-soft">
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-primary" /> Recent repos
              </h2>
              {loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
              ) : (stats?.recentRepos?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No repositories analyzed yet.</p>
              ) : (
                <div className="space-y-3">
                  {(stats?.recentRepos ?? []).map((r) => (
                    <Link key={`${r.owner}/${r.repo}@${r.ref}`} to="/repository" className="block p-3 rounded-lg border border-border bg-secondary/40 hover:bg-secondary hover:border-primary/40 transition">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-mono truncate">{r.owner}/{r.repo}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{r.ref === r.default_branch ? "default" : r.ref}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono">updated {timeAgo(r.fetched_at)}</p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: GitBranch, title: "Repository analysis", desc: "Tree, dependencies, tech stack & architecture overview.", to: "/repository" as const },
              { icon: FileText, title: "Auto documentation", desc: "Generate Markdown docs for files, modules and APIs.", to: "/docs" as const },
              { icon: Bot, title: "Q&A assistant", desc: "Ask natural-language questions about your codebase.", to: "/chat" as const },
            ].map((c) => (
              <Link key={c.title} to={c.to} className="rounded-xl glass p-5 shadow-soft hover:ring-1 hover:ring-primary/40 transition group">
                <c.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-base font-display font-semibold">{c.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition">
                  Open <ArrowUpRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </section>
        </div>
      </div>
    </AppLayout>
  );
}