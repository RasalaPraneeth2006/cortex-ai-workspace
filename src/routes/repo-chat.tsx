import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Markdown } from "@/components/Markdown";
import { pythonApi } from "@/lib/python-api";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Database, Github, Loader2, Send, Sparkles, User, FileCode2 } from "lucide-react";

export const Route = createFileRoute("/repo-chat")({
  head: () => ({
    meta: [
      { title: "Repo Chat — Cortex" },
      { name: "description", content: "Repository-aware AI chat with grounded citations." },
    ],
  }),
  component: RepoChatPage,
});

type Source = { n: number; path: string; chunk_index: number; rank: number };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };

type IndexJob = {
  id: string;
  status: string;
  progress: number;
  message: string | null;
  error: string | null;
};

function RepoChatPage() {
  const [repoUrl, setRepoUrl] = useState("facebook/react");
  const [ref, setRef] = useState("");
  const [stats, setStats] = useState<{ files: number; chunks: number; lastIndexedAt: string | null } | null>(null);
  const [job, setJob] = useState<IndexJob | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const parsed = parseRepo(repoUrl);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  // Live job updates
  useEffect(() => {
    if (!job?.id) return;
    const ch = supabase
      .channel(`job-${job.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${job.id}` },
        (payload) => {
          const r = payload.new as IndexJob;
          setJob(r);
          if (r.status === "done" && parsed) refreshStats();
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [job?.id, parsed?.owner, parsed?.repo]);

  async function refreshStats() {
    if (!parsed) return;
    try {
      const s = await pythonApi.rag.stats({ owner: parsed.owner, repo: parsed.repo, ref: ref || undefined });
      setStats({ files: s.files, chunks: s.chunks, lastIndexedAt: s.lastIndexedAt ?? null });
    } catch {/* ignore */}
  }

  useEffect(() => { void refreshStats(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [repoUrl, ref]);

  async function startIndex() {
    setErr("");
    if (!parsed) { setErr("Enter owner/repo or a GitHub URL"); return; }
    try {
      const r = await pythonApi.jobs.enqueue({ kind: "repo_index", owner: parsed.owner, repo: parsed.repo, ref: ref || undefined });
      setJob({ id: r.jobId, status: "queued", progress: 0, message: "Queued", error: null });
    } catch (e) { setErr((e as Error).message); }
  }

  async function send(text?: string) {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    if (!parsed) { setErr("Enter a repository first"); return; }
    setErr("");
    setInput("");
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next);
    setBusy(true);
    try {
      const r = await pythonApi.rag.chat({
        owner: parsed.owner, repo: parsed.repo, ref: ref || stats?.lastIndexedAt ? (ref || "main") : "main",
        question: t, history,
      });
      setMsgs([...next, { role: "assistant", content: r.answer || "_(empty response)_", sources: r.sources }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `❌ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppLayout>
      <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4 h-[calc(100vh-6rem)]">
        {/* Left: index controls */}
        <aside className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /><h2 className="font-semibold text-sm">Repository Index</h2></div>
          <label className="text-xs text-muted-foreground">GitHub repo</label>
          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2">
            <Github className="h-4 w-4 text-muted-foreground" />
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="owner/repo or URL"
              className="flex-1 bg-transparent py-2 text-sm outline-none" />
          </div>
          <label className="text-xs text-muted-foreground">Branch (optional)</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="default branch"
            className="rounded-md border border-input bg-background px-2 py-2 text-sm" />

          <button onClick={startIndex}
            disabled={!parsed || job?.status === "running" || job?.status === "queued"}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {job?.status === "running" || job?.status === "queued" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {job?.status === "running" || job?.status === "queued" ? "Indexing…" : "Index repository"}
          </button>

          {job && (
            <div className="rounded-md border border-border bg-background p-2 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium capitalize">{job.status}</span>
                <span className="text-muted-foreground">{job.progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} />
              </div>
              {job.message && <p className="text-muted-foreground">{job.message}</p>}
              {job.error && <p className="text-destructive">{job.error}</p>}
            </div>
          )}

          <div className="mt-2 rounded-md border border-border bg-background p-3 text-xs">
            <div className="flex items-center gap-2 mb-1"><FileCode2 className="h-3.5 w-3.5 text-primary" /><span className="font-medium">Index status</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Files</span><span>{stats?.files ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Chunks</span><span>{stats?.chunks ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last indexed</span>
              <span>{stats?.lastIndexedAt ? new Date(stats.lastIndexedAt).toLocaleString() : "never"}</span></div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-snug">
            Indexes up to 200 source files per run. Uses Postgres full-text search to retrieve grounded snippets, then asks the AI with citations.
          </p>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </aside>

        {/* Right: chat */}
        <section className="rounded-lg border border-border bg-card flex flex-col min-h-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Repo-aware chat</h2>
            {parsed && <span className="ml-auto text-xs text-muted-foreground">{parsed.owner}/{parsed.repo}{ref ? `@${ref}` : ""}</span>}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {msgs.length === 0 && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>Ask anything about the indexed repository. Examples:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>How is authentication implemented?</li>
                  <li>Where do API routes live and how are they wired?</li>
                  <li>Explain the build configuration.</li>
                </ul>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </div>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary/10" : "bg-background border border-border"}`}>
                  <Markdown content={m.content} />
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/60">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Sources</p>
                      <ul className="space-y-0.5">
                        {m.sources.map((s) => (
                          <li key={s.n} className="text-[11px] font-mono text-muted-foreground">
                            <span className="text-primary">[#{s.n}]</span> {s.path}
                            <span className="opacity-60"> · chunk {s.chunk_index}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching repo and generating answer…
              </div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void send(); }}
            className="border-t border-border p-3 flex items-center gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={parsed ? `Ask about ${parsed.owner}/${parsed.repo}…` : "Enter a repo on the left first…"}
              disabled={busy}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
            <button type="submit" disabled={busy || !input.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </form>
        </section>
      </div>
    </AppLayout>
  );
}

function parseRepo(s: string): { owner: string; repo: string } | null {
  const trimmed = s.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const m = trimmed.match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}
