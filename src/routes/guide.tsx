import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard, GitBranch, Code2, Users, MessageSquareCode, Database,
  FileText, FileBarChart2, ShieldCheck, Github, Sparkles, Lock, KeyRound,
  Workflow, Boxes, Rocket, ChevronRight, BookOpen, Zap, Server, Cloud,
  Cpu, Palette, Radio, Search, GitCommit, Bot, ArrowRight, X,
} from "lucide-react";

export const Route = createFileRoute("/guide")({
  head: () => ({
    meta: [
      { title: "Guide — Cortex Developer Intelligence" },
      { name: "description", content: "Complete guide to Cortex: workflows, features, private repo access, and the tech stack behind the platform." },
      { property: "og:title", content: "Cortex Guide — How everything works" },
      { property: "og:description", content: "Architecture, workflows, private repo access, and per-section usage for the Cortex platform." },
    ],
  }),
  component: GuidePage,
});

function useReveal() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { threshold: 0.15 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return { ref, visible };
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
    >
      {children}
    </div>
  );
}

const sections = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "workflow", label: "Workflow" },
  { id: "features", label: "Features" },
  { id: "private", label: "Private Repos" },
  { id: "stack", label: "Tech Stack" },
  { id: "quickstart", label: "Quickstart" },
];

const features = [
  { icon: LayoutDashboard, name: "Dashboard", to: "/", color: "from-sky-500 to-indigo-500",
    desc: "Live counts for repos analyzed, files explained, chunks indexed, and background jobs. Realtime via the jobs table." },
  { icon: GitBranch, name: "Repository", to: "/repository", color: "from-emerald-500 to-teal-500",
    desc: "Paste a GitHub URL, browse the file tree, click any file for an instant AI explanation. Recursive or lazy loading auto-selected." },
  { icon: Code2, name: "Editor", to: "/editor", color: "from-fuchsia-500 to-pink-500",
    desc: "Monaco-based IDE with tabs, split view, auto-save, AI actions (Generate/Correct/Refactor/Optimize/Explain), and a real shell over workspace files." },
  { icon: Users, name: "Team Chat", to: "/team", color: "from-orange-500 to-rose-500",
    desc: "Realtime channels with @mentions, file attachments, and shareable invite links. Powered by Postgres Realtime." },
  { icon: MessageSquareCode, name: "AI Chat", to: "/chat", color: "from-violet-500 to-purple-500",
    desc: "General-purpose LLM chat for quick coding questions, snippets, and explanations." },
  { icon: Database, name: "Repo Chat (RAG)", to: "/repo-chat", color: "from-cyan-500 to-blue-500",
    desc: "Index a repository into tsvector chunks, then ask questions grounded in real code with citations like [#1]." },
  { icon: FileText, name: "Docs", to: "/docs", color: "from-amber-500 to-orange-500",
    desc: "Every AI file explanation is cached and browsable here — your team's living knowledge base." },
  { icon: FileBarChart2, name: "Reports", to: "/reports", color: "from-green-500 to-emerald-500",
    desc: "Per-repo insights: file counts, language distribution, indexing status. Generate downloadable Markdown reports." },
  { icon: ShieldCheck, name: "Access", to: "/access", color: "from-red-500 to-rose-500",
    desc: "Install the Cortex GitHub App, verify private repo permissions, manage requests, and view the audit log." },
];

const stack = [
  { icon: Cpu, name: "React 19 + TanStack Start", desc: "SSR-first router with typed server functions." },
  { icon: Palette, name: "Tailwind v4 + shadcn/ui", desc: "Design tokens in styles.css, Radix primitives." },
  { icon: Code2, name: "Monaco Editor", desc: "The same editor VS Code uses, with multi-language syntax." },
  { icon: Cloud, name: "Lovable Cloud (Postgres)", desc: "Auth, RLS, storage, and realtime subscriptions." },
  { icon: Radio, name: "Postgres Realtime", desc: "Live chat, presence, and job progress streaming." },
  { icon: Search, name: "Postgres FTS (tsvector)", desc: "Chunk-level search powering the RAG repo chat." },
  { icon: Bot, name: "Lovable AI Gateway", desc: "LLM calls for explain, refactor, RAG, and reports." },
  { icon: Github, name: "GitHub App", desc: "Short-lived installation tokens for private repo access." },
  { icon: Server, name: "Cloudflare Workers", desc: "Edge runtime for server functions and SSR." },
];

const workflow = [
  { icon: Github, title: "Connect", text: "Install the Cortex GitHub App on your user or org from /access." },
  { icon: GitBranch, title: "Fetch", text: "Paste a repo URL. Tree + branches load via cached installation token." },
  { icon: Sparkles, title: "Explain", text: "Click any file. LLM output is cached in ai_explain_cache." },
  { icon: Database, title: "Index", text: "Run RAG indexing to chunk source files into searchable tsvectors." },
  { icon: MessageSquareCode, title: "Ask", text: "Chat with the repo. Answers cite specific code chunks." },
  { icon: GitCommit, title: "Commit", text: "Push edits back via the Git Data API from the editor." },
];

interface SearchItem {
  id: string;
  sectionId: string;
  sectionLabel: string;
  title: string;
  text: string;
}

// Normalize: lowercase, strip punctuation, collapse whitespace, singularize simple plurals.
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

// Fuzzy subsequence: are all chars of q present in order inside t?
function subsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}

// Score a single query token against a haystack token.
function tokenScore(qt: string, ht: string): number {
  if (!qt || !ht) return 0;
  if (ht === qt) return 100;
  if (ht.startsWith(qt)) return 70;
  if (ht.includes(qt)) return 45;
  // Fuzzy: allow subsequence when query is at least 3 chars and reasonably close in length.
  if (qt.length >= 3 && ht.length <= qt.length * 3 && subsequence(qt, ht)) return 20;
  return 0;
}

function scoreItem(qTokens: string[], item: SearchItem): number {
  if (qTokens.length === 0) return 0;
  const titleTokens = tokens(item.title);
  const sectionTokens = tokens(item.sectionLabel);
  const textTokens = tokens(item.text);
  const rawQuery = qTokens.join(" ");
  const rawTitle = normalizeText(item.title);
  const rawSection = normalizeText(item.sectionLabel);
  const rawText = normalizeText(item.text);

  let score = 0;
  let matched = 0;

  for (const qt of qTokens) {
    let best = 0;
    for (const ht of titleTokens) best = Math.max(best, tokenScore(qt, ht) * 2.2);
    for (const ht of sectionTokens) best = Math.max(best, tokenScore(qt, ht) * 2.0);
    for (const ht of textTokens) best = Math.max(best, tokenScore(qt, ht) * 1.0);
    if (best > 0) matched++;
    score += best;
  }

  // Require at least one meaningful match.
  if (matched === 0) return 0;

  // Boost when all query tokens matched something.
  if (matched === qTokens.length) score += 40;

  // Phrase boosts.
  if (rawTitle.includes(rawQuery)) score += 80;
  if (rawSection.includes(rawQuery)) score += 60;
  if (rawText.includes(rawQuery)) score += 25;

  return score;
}

function fuzzySearch(query: string, index: SearchItem[]): SearchItem[] {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return [];
  const scored = index
    .map((item) => ({ item, score: scoreItem(qTokens, item) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  return scored.map((r) => r.item);
}

function buildSearchIndex(): SearchItem[] {
  const items: SearchItem[] = [];

  items.push({ id: "overview", sectionId: "overview", sectionLabel: "Overview", title: "Overview", text: "What Cortex is. AI-native. Realtime by default. Secure private repos." });

  items.push({ id: "architecture", sectionId: "architecture", sectionLabel: "Architecture", title: "Architecture", text: "How the pieces fit together. Browser React 19 Monaco Realtime UI. TanStack Start SSR createServerFn API. Postgres Realtime RLS tsvector FTS. Lovable AI Gateway explain refactor rag. Storage chat-files. GitHub App tokens." });

  workflow.forEach((w, i) => {
    items.push({ id: `wf-${i}`, sectionId: "workflow", sectionLabel: "Workflow", title: w.title, text: w.text });
  });

  features.forEach((f) => {
    items.push({ id: `feat-${f.name}`, sectionId: "features", sectionLabel: "Features", title: f.name, text: f.desc });
  });

  items.push({ id: "private", sectionId: "private", sectionLabel: "Private Repos", title: "GitHub App flow (recommended)", text: "Open /access and click Install GitHub App. On GitHub pick the user or org and select which repos to grant. Return to Cortex — the installation is recorded automatically. Paste any private repo URL under that owner in /repository." });
  items.push({ id: "private-uth", sectionId: "private", sectionLabel: "Private Repos", title: "Under the hood", text: "Installation tokens are minted server-side per request (1h TTL cached). Personal PATs are encrypted with AES-256-GCM before storage. Org membership + SSO enforcement are checked on verification. Every access event lands in access_audit_logs. Cortex roles Owner Admin Editor Viewer mirror GitHub permissions." });

  stack.forEach((s) => {
    items.push({ id: `stack-${s.name}`, sectionId: "stack", sectionLabel: "Tech Stack", title: s.name, text: s.desc });
  });

  [
    { label: "Sign in with email or GitHub." },
    { label: "Install the Cortex GitHub App on your account." },
    { label: "Paste a repo URL and browse the tree." },
    { label: "Index the repo and ask grounded questions." },
    { label: "Open a file, use AI actions, and commit back." },
    { label: "Invite teammates with a shareable link." },
  ].forEach((q, i) => {
    items.push({ id: `qs-${i}`, sectionId: "quickstart", sectionLabel: "Quickstart", title: `Step ${i + 1}`, text: q.label });
  });

  return items;
}

function GuidePage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchIndex = useMemo(() => buildSearchIndex(), []);

  const normalized = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!normalized) return [];
    return fuzzySearch(normalized, searchIndex);
  }, [normalized, searchIndex]);

  const goTo = (sectionId: string) => {
    setOpen(false);
    setQuery("");
    setHighlighted(sectionId);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setTimeout(() => setHighlighted(null), 2000);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 opacity-40"
             style={{ background: "radial-gradient(600px 300px at 20% 0%, hsl(var(--primary)/0.25), transparent), radial-gradient(500px 260px at 90% 20%, hsl(var(--accent)/0.2), transparent)" }} />
        <div className="relative mx-auto max-w-6xl px-6 py-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 backdrop-blur px-3 py-1 text-xs animate-fade-in">
            <BookOpen className="h-3.5 w-3.5 text-primary" />
            Cortex Guide
          </div>
          <h1 className="mt-4 font-display text-4xl md:text-6xl font-semibold tracking-tight animate-fade-in">
            Everything about <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Cortex</span>
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground animate-fade-in">
            Architecture, workflow, per-section usage, private repository access, and the full tech stack — in one place.
          </p>

          {/* Search */}
          <div className="mt-8 max-w-xl relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Search guide… (e.g. private repos, workflow, tech stack)"
                className="w-full rounded-xl border border-border/60 bg-card/60 pl-9 pr-10 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-muted-foreground/60"
              />
              {query && (
                <button
                  onClick={() => { setQuery(""); setOpen(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <div className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 items-center gap-1 text-[11px] text-muted-foreground/60 pointer-events-none">
                <kbd className="rounded border border-border/50 bg-background/60 px-1.5 py-0.5 font-mono">Ctrl</kbd>
                <span>+</span>
                <kbd className="rounded border border-border/50 bg-background/60 px-1.5 py-0.5 font-mono">K</kbd>
              </div>
            </div>

            {open && normalized && (
              <div className="absolute z-50 mt-2 w-full rounded-xl border border-border/60 bg-card/95 backdrop-blur shadow-xl overflow-hidden">
                {results.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground text-center">No results found.</div>
                ) : (
                  <ul className="max-h-80 overflow-y-auto py-1">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => goTo(r.sectionId)}
                          className="w-full text-left px-4 py-2.5 hover:bg-primary/10 transition-colors flex items-start gap-3"
                        >
                          <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-mono shrink-0 w-24 truncate">
                            {r.sectionLabel}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{r.title}</div>
                            <div className="text-xs text-muted-foreground truncate">{r.text}</div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {sections.map((s, i) => (
              <a key={s.id} href={`#${s.id}`}
                 className="px-3 py-1.5 text-xs rounded-full border border-border/60 hover:border-primary/60 hover:text-primary transition-all hover-scale"
                 style={{ animationDelay: `${i * 60}ms` }}>
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-14 space-y-24">

        {/* Overview */}
        <section id="overview" className={highlighted === "overview" ? "scroll-mt-8" : ""}>
          <Reveal>
            <SectionHeader icon={Rocket} kicker="01 · Overview" title="What Cortex is" />
          </Reveal>
          <div className="grid md:grid-cols-3 gap-4 mt-8">
            {[
              { icon: Zap, title: "AI-native", text: "Every surface — repo browser, editor, chat, reports — is wired to an LLM." },
              { icon: Radio, title: "Realtime by default", text: "Jobs, chat, presence, and dashboards update over Postgres Realtime." },
              { icon: Lock, title: "Secure private repos", text: "Server-minted GitHub App tokens, encrypted PATs, RLS on every table." },
            ].map((c, i) => (
              <Reveal key={c.title} delay={i * 100}>
                <div className="group relative rounded-xl border border-border/60 bg-card/60 p-5 hover:border-primary/50 transition-all hover:-translate-y-1">
                  <c.icon className="h-6 w-6 text-primary mb-3" />
                  <div className="font-medium">{c.title}</div>
                  <p className="text-sm text-muted-foreground mt-1">{c.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section id="architecture" className={highlighted === "architecture" ? "scroll-mt-8" : ""}>
          <Reveal><SectionHeader icon={Boxes} kicker="02 · Architecture" title="How the pieces fit together" /></Reveal>
          <Reveal delay={100}>
            <div className="mt-8 rounded-2xl border border-border/60 bg-card/40 p-6 overflow-x-auto">
              <pre className="text-[11px] md:text-xs leading-relaxed text-muted-foreground font-mono">{`
  ┌────────────────────────┐        ┌──────────────────────────┐
  │   Browser (React 19)   │◀──────▶│   TanStack Start (SSR)   │
  │  Monaco · Realtime UI  │  RPC   │   createServerFn / API   │
  └───────────┬────────────┘        └──────────┬───────────────┘
              │ Supabase JS                    │ service role
              ▼                                ▼
  ┌────────────────────────┐        ┌──────────────────────────┐
  │  Postgres + Realtime   │◀──────▶│   Lovable AI Gateway     │
  │  RLS · tsvector · FTS  │        │  explain · refactor · rag│
  └───────────┬────────────┘        └──────────┬───────────────┘
              │                                │
              ▼                                ▼
  ┌────────────────────────┐        ┌──────────────────────────┐
  │   Storage (chat-files) │        │   GitHub App (tokens)    │
  └────────────────────────┘        └──────────────────────────┘
`}</pre>
            </div>
          </Reveal>
        </section>

        {/* Workflow */}
        <section id="workflow" className={highlighted === "workflow" ? "scroll-mt-8" : ""}>
          <Reveal><SectionHeader icon={Workflow} kicker="03 · Workflow" title="From repo URL to shipped commit" /></Reveal>
          <div className="mt-10 relative">
            <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-primary/60 via-primary/20 to-transparent md:hidden" />
            <div className="hidden md:block absolute top-6 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="grid md:grid-cols-6 gap-6">
              {workflow.map((step, i) => (
                <Reveal key={step.title} delay={i * 120}>
                  <div className="relative pl-16 md:pl-0 md:text-center">
                    <div className="md:mx-auto h-12 w-12 rounded-xl border border-primary/40 bg-primary/10 flex items-center justify-center relative z-10 shadow-[0_0_30px_hsl(var(--primary)/0.25)]">
                      <step.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="absolute left-0 md:hidden top-3 text-xs font-mono text-muted-foreground">0{i + 1}</div>
                    <div className="mt-3 font-medium">{step.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{step.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className={highlighted === "features" ? "scroll-mt-8" : ""}>
          <Reveal><SectionHeader icon={Sparkles} kicker="04 · Sections" title="How to use each part of Cortex" /></Reveal>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
            {features.map((f, i) => (
              <Reveal key={f.name} delay={i * 60}>
                <Link to={f.to}
                      className="group block relative overflow-hidden rounded-xl border border-border/60 bg-card/60 p-5 hover:border-primary/50 hover:-translate-y-1 transition-all">
                  <div className={`absolute inset-x-0 -top-24 h-32 opacity-0 group-hover:opacity-30 blur-2xl bg-gradient-to-r ${f.color} transition-opacity`} />
                  <div className="relative flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${f.color} flex items-center justify-center shrink-0`}>
                      <f.icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{f.name}</div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-1 group-hover:text-primary transition-all" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{f.desc}</p>
                      <div className="text-[11px] font-mono text-muted-foreground/70 mt-2">{f.to}</div>
                    </div>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Private repos */}
        <section id="private" className={highlighted === "private" ? "scroll-mt-8" : ""}>
          <Reveal><SectionHeader icon={Lock} kicker="05 · Private repositories" title="Analyzing private & org repos" /></Reveal>
          <div className="grid md:grid-cols-2 gap-6 mt-8">
            <Reveal>
              <div className="rounded-xl border border-border/60 bg-card/60 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Github className="h-5 w-5 text-primary" />
                  <div className="font-medium">GitHub App flow (recommended)</div>
                </div>
                <ol className="space-y-3 text-sm">
                  {[
                    "Open /access and click Install GitHub App.",
                    "On GitHub, pick the user or org and select which repos to grant.",
                    "Return to Cortex — the installation is recorded automatically.",
                    "Paste any private repo URL under that owner in /repository. Done.",
                  ].map((t, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="h-6 w-6 shrink-0 rounded-full bg-primary/15 text-primary text-xs font-mono flex items-center justify-center">{i + 1}</span>
                      <span className="text-muted-foreground">{t}</span>
                    </li>
                  ))}
                </ol>
                <Link to="/access" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                  Open Access <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="rounded-xl border border-border/60 bg-card/60 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-primary" />
                  <div className="font-medium">Under the hood</div>
                </div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Installation tokens are minted server-side per request (1h TTL, cached).</li>
                  <li>• Personal PATs are encrypted with AES-256-GCM before storage.</li>
                  <li>• Org membership + SSO enforcement are checked on verification.</li>
                  <li>• Every access event lands in <code className="text-primary">access_audit_logs</code>.</li>
                  <li>• Cortex roles (Owner/Admin/Editor/Viewer) mirror GitHub permissions.</li>
                </ul>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Tech stack */}
        <section id="stack" className={highlighted === "stack" ? "scroll-mt-8" : ""}>
          <Reveal><SectionHeader icon={Boxes} kicker="06 · Tech stack" title="What powers Cortex" /></Reveal>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
            {stack.map((s, i) => (
              <Reveal key={s.name} delay={i * 60}>
                <div className="rounded-xl border border-border/60 bg-card/60 p-5 hover:border-primary/50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg border border-border/60 bg-background/60 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <s.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="font-medium">{s.name}</div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-3">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Quickstart */}
        <section id="quickstart" className={highlighted === "quickstart" ? "scroll-mt-8" : ""}>
          <Reveal><SectionHeader icon={Rocket} kicker="07 · Quickstart" title="Get productive in 5 minutes" /></Reveal>
          <Reveal delay={100}>
            <div className="mt-8 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card/60 to-accent/10 p-8">
              <ol className="grid md:grid-cols-2 gap-4">
                {[
                  { to: "/auth", label: "Sign in with email or GitHub." },
                  { to: "/access", label: "Install the Cortex GitHub App on your account." },
                  { to: "/repository", label: "Paste a repo URL and browse the tree." },
                  { to: "/repo-chat", label: "Index the repo and ask grounded questions." },
                  { to: "/editor", label: "Open a file, use AI actions, and commit back." },
                  { to: "/team", label: "Invite teammates with a shareable link." },
                ].map((s, i) => (
                  <li key={s.to}>
                    <Link to={s.to} className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/60 p-3 hover:border-primary/60 hover:bg-background/80 transition-all">
                      <span className="h-7 w-7 rounded-full bg-primary/20 text-primary text-xs font-mono flex items-center justify-center">{i + 1}</span>
                      <span className="text-sm flex-1">{s.label}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, kicker, title }: { icon: React.ComponentType<{ className?: string }>; kicker: string; title: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {kicker}
      </div>
      <h2 className="mt-2 font-display text-2xl md:text-3xl font-semibold tracking-tight">{title}</h2>
    </div>
  );
}
