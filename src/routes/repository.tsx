import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Markdown } from "@/components/Markdown";
import { pythonApi } from "@/lib/python-api";
import type { RepoMeta, GhTreeItem } from "@/lib/python-api";
import { supabase } from "@/integrations/supabase/client";
import {
  GitBranch, Loader2, Star, GitFork, Folder, FileCode2, ChevronRight, ChevronDown,
  Sparkles, Search, Github,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

export const Route = createFileRoute("/repository")({
  head: () => ({
    meta: [
      { title: "Repository Viewer — Cortex" },
      { name: "description", content: "Analyze any GitHub repository with AI-powered file explanations." },
    ],
  }),
  component: RepoPage,
});

type Node = {
  name: string; path: string; type: "tree" | "blob";
  sha?: string; size?: number;
  children?: Node[];
  loaded?: boolean; loading?: boolean;
};

function buildTree(items: GhTreeItem[]): Node {
  const root: Node = { name: "", path: "", type: "tree", children: [] };
  for (const it of items) {
    const parts = it.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      cur.children = cur.children || [];
      let next = cur.children.find((c) => c.name === part);
      if (!next) {
        next = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: isLast ? it.type : "tree",
          sha: isLast ? it.sha : undefined,
          size: isLast ? it.size : undefined,
          children: it.type === "tree" || !isLast ? [] : undefined,
          loaded: it.type === "tree" || !isLast ? false : undefined,
        };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sort = (n: Node) => {
    if (!n.children) return;
    n.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

function langFromPath(p: string) {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", java: "java", rb: "ruby",
    css: "css", html: "markup", json: "json", md: "markdown", yml: "yaml", yaml: "yaml",
    sh: "bash", c: "c", cpp: "cpp", h: "c", swift: "swift", kt: "kotlin", php: "php", sql: "sql",
  };
  return map[ext] ?? "text";
}

function RepoPage() {
  const [input, setInput] = useState("https://github.com/vercel/ai");
  const [meta, setMeta] = useState<RepoMeta | null>(null);
  const [activeBranch, setActiveBranch] = useState<string>("");
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [explanation, setExplanation] = useState<string>("");
  const [explaining, setExplaining] = useState(false);
  const [filter, setFilter] = useState("");
  const [, setTreeVersion] = useState(0);
  const [jobStatus, setJobStatus] = useState<{
    id: string; status: string; progress: number; message: string | null; attempts: number;
  } | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

  const repoCache = useRef<Map<string, RepoMeta>>(new Map());
  const fileCache = useRef<Map<string, string>>(new Map());
  const explainCache = useRef<Map<string, string>>(new Map());

  // Realtime: subscribe to all job updates; only react to the active one.
  useEffect(() => {
    const channel = supabase
      .channel("jobs-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        (payload) => {
          const row = payload.new as {
            id: string; status: string; progress: number; message: string | null;
            attempts: number; result: { explanation?: string } | null; error: string | null;
          };
          if (!row?.id || row.id !== activeJobIdRef.current) return;
          setJobStatus({
            id: row.id, status: row.status, progress: row.progress,
            message: row.message, attempts: row.attempts,
          });
          if (row.status === "done" && row.result?.explanation) {
            setExplanation(row.result.explanation);
            setExplaining(false);
          } else if (row.status === "error") {
            setExplanation(`⚠️ ${row.error ?? "Job failed"}`);
            setExplaining(false);
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const tree = useMemo(() => (meta ? buildTree(meta.tree) : null), [meta]);

  const parseRepoInput = (raw: string): { owner: string; repo: string } | null => {
    const s = raw.trim();
    if (!s) return null;
    const urlMatch = s.match(/github\.com[:/]+([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
    if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
    const slashMatch = s.match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/);
    if (slashMatch) return { owner: slashMatch[1], repo: slashMatch[2] };
    return null;
  };

  const loadRepo = async (owner: string, repo: string, ref?: string) => {
    const cacheKey = `${owner}/${repo}@${ref ?? "_default"}`.toLowerCase();
    const cached = repoCache.current.get(cacheKey);
    if (cached) { setMeta(cached); setActiveBranch(cached.defaultBranch); return; }
    setLoadingRepo(true); setMeta(null);
    try {
      const data = await pythonApi.github.fetchRepo({ owner, repo, ref });
      repoCache.current.set(cacheKey, data);
      setMeta(data);
      setActiveBranch(ref ?? data.defaultBranch);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.includes("rate limit") ? "GitHub rate limit reached. Try again later." : msg);
    } finally { setLoadingRepo(false); }
  };

  const onFetch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null); setActivePath(null); setFileContent(null); setExplanation("");
    const parsed = parseRepoInput(input);
    if (!parsed) { setError("Enter a GitHub URL (https://github.com/owner/repo) or owner/repo."); return; }
    await loadRepo(parsed.owner, parsed.repo);
  };

  const onChangeBranch = async (branch: string) => {
    if (!meta) return;
    setActiveBranch(branch);
    setActivePath(null); setFileContent(null); setExplanation("");
    await loadRepo(meta.owner, meta.repo, branch);
  };

  const pickFile = async (path: string, autoExplain: boolean) => {
    if (!meta) return;
    const ref = activeBranch || meta.defaultBranch;
    setActivePath(path); setExplanation("");
    const fileKey = `${meta.owner}/${meta.repo}@${ref}:${path}`;
    const cachedFile = fileCache.current.get(fileKey);
    if (cachedFile !== undefined) {
      setFileContent(cachedFile);
    } else {
      setFileContent(null); setLoadingFile(true);
      try {
        const f = await pythonApi.github.fetchFile({ owner: meta.owner, repo: meta.repo, ref, path });
        fileCache.current.set(fileKey, f.content);
        setFileContent(f.content);
      } catch (err) {
        setFileContent(`// Error loading file: ${(err as Error).message}`);
        setLoadingFile(false);
        return;
      }
      setLoadingFile(false);
    }
    if (!autoExplain) return;
    const cachedExplain = explainCache.current.get(fileKey);
    if (cachedExplain) { setExplanation(cachedExplain); return; }
    void runExplain(path, fileKey);
  };

  const runExplain = async (path: string, fileKey: string) => {
    if (!meta) return;
    const code = fileCache.current.get(fileKey);
    if (code && isBinaryOrUnsupported(path, code)) {
      setExplanation(`_Skipped AI analysis: \`${path.split("/").pop()}\` looks binary or unsupported._`);
      return;
    }
    setExplaining(true); setExplanation(""); setJobStatus(null);
    try {
      const ref = activeBranch || meta.defaultBranch;
      const res = await pythonApi.jobs.enqueue({
        kind: "file_explain", owner: meta.owner, repo: meta.repo, ref, path, language: langFromPath(path)
      });
      activeJobIdRef.current = res.jobId;
      const r = res as { jobId: string; result?: { explanation: string; cached: boolean }; error?: string };
      if (r.error) {
        setExplanation(`⚠️ ${r.error}`);
      } else if (r.result?.explanation) {
        explainCache.current.set(fileKey, r.result.explanation);
        setExplanation(r.result.explanation);
        setJobStatus({ id: res.jobId, status: "done", progress: 100, message: r.result.cached ? "Done (from cache)" : "Done", attempts: 1 });
      } else {
        setJobStatus({ id: res.jobId, status: "queued", progress: 0, message: "Queued", attempts: 0 });
      }
      setExplaining(false);
    } catch (err) {
      setExplanation(`⚠️ ${(err as Error).message}`);
      setExplaining(false);
    }
  };

  const onExplain = () => {
    if (!activePath || !meta) return;
    const ref = activeBranch || meta.defaultBranch;
    const fileKey = `${meta.owner}/${meta.repo}@${ref}:${activePath}`;
    explainCache.current.delete(fileKey);
    void runExplain(activePath, fileKey);
  };

  const onLazyLoadFolder = async (folderNode: Node) => {
    if (!meta || !folderNode.sha || folderNode.loaded || folderNode.loading) return;
    folderNode.loading = true; setTreeVersion((v) => v + 1);
    try {
      const { items } = await pythonApi.github.fetchSubtree({
        owner: meta.owner, repo: meta.repo, sha: folderNode.sha, basePath: folderNode.path
      });
      folderNode.children = items
        .map((it) => ({
          name: it.path.split("/").pop()!,
          path: it.path,
          type: it.type,
          sha: it.sha,
          size: it.size,
          children: it.type === "tree" ? [] : undefined,
          loaded: it.type === "tree" ? false : undefined,
        }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1));
      folderNode.loaded = true;
    } catch (err) {
      console.error(err);
    } finally {
      folderNode.loading = false;
      setTreeVersion((v) => v + 1);
    }
  };

  return (
    <AppLayout>
      <div className="grid-bg min-h-full">
        <div className="px-4 md:px-6 py-6 max-w-[1500px] mx-auto space-y-5">
          <div className="rounded-xl glass-strong p-4 md:p-5 shadow-soft">
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="h-4 w-4 text-primary" />
              <h1 className="text-lg font-display font-semibold">Repository viewer</h1>
            </div>
            <form onSubmit={onFetch} className="flex flex-col md:flex-row gap-2">
              <div className="flex flex-1 items-center rounded-lg bg-input/60 border border-border focus-within:ring-2 focus-within:ring-primary/30 overflow-hidden">
                <Github className="h-4 w-4 mx-3 text-muted-foreground" />
                <input value={input} onChange={(e) => setInput(e.target.value)}
                  placeholder="https://github.com/owner/repo  or  owner/repo (public or private with token)"
                  className="flex-1 min-w-0 bg-transparent py-2.5 pr-3 text-sm focus:outline-none font-mono" />
              </div>
              <button type="submit" disabled={loadingRepo}
                className="h-10 px-5 rounded-lg text-sm font-medium text-primary-foreground inline-flex items-center justify-center gap-2 disabled:opacity-60 transition hover:opacity-90"
                style={{ background: "var(--gradient-primary)" }}>
                {loadingRepo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Analyze
              </button>
            </form>
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            {meta && (
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{meta.owner}/{meta.repo}</span>
                <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" /> {meta.stars.toLocaleString()}</span>
                <span className="inline-flex items-center gap-1"><GitFork className="h-3 w-3" /> {meta.forks.toLocaleString()}</span>
                {meta.language && <span className="px-2 py-0.5 rounded-full bg-secondary text-foreground/80">{meta.language}</span>}
                <label className="inline-flex items-center gap-1.5">
                  <GitBranch className="h-3 w-3" />
                  <select
                    value={activeBranch || meta.defaultBranch}
                    onChange={(e) => onChangeBranch(e.target.value)}
                    className="bg-input/60 border border-border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {meta.branches.map((b) => (
                      <option key={b} value={b}>{b}{b === meta.defaultBranch ? " (default)" : ""}</option>
                    ))}
                  </select>
                </label>
                {meta.description && <span className="basis-full text-foreground/80">{meta.description}</span>}
                {meta.lazy && <span className="basis-full text-amber-400/80">⚡ Large repo — folders load on demand.</span>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_360px] gap-4 min-h-[60vh]">
            <div className="rounded-xl glass shadow-soft flex flex-col min-h-[400px] max-h-[75vh]">
              <div className="p-3 border-b border-border/70 relative">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files…"
                  className="w-full pl-7 h-8 rounded-md bg-input/60 border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
                {!tree && (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    Enter a GitHub repo above to see its file tree.
                  </div>
                )}
                {tree && tree.children?.map((n) => (
                  <TreeNode
                    key={n.path} node={n} depth={0} active={activePath}
                    onPick={(p) => pickFile(p, false)}
                    onExplain={(p) => pickFile(p, true)}
                    onLoadFolder={onLazyLoadFolder}
                    lazy={!!meta?.lazy}
                    filter={filter.toLowerCase()}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-xl glass shadow-soft flex flex-col min-h-[400px] max-h-[75vh] overflow-hidden">
              <div className="h-10 px-4 border-b border-border/70 flex items-center gap-2 text-xs">
                <FileCode2 className="h-3.5 w-3.5 text-primary" />
                <span className="font-mono truncate">{activePath ?? "no file selected"}</span>
                <span className="ml-auto text-muted-foreground">{activePath ? langFromPath(activePath) : ""}</span>
              </div>
              <div className="flex-1 overflow-auto scrollbar-thin">
                {!activePath && (
                  <div className="h-full flex items-center justify-center p-8 text-center">
                    <div>
                      <FileCode2 className="h-8 w-8 text-muted-foreground mx-auto" />
                      <p className="mt-3 text-sm text-muted-foreground">Pick a file from the tree, or click the <Sparkles className="inline h-3 w-3 text-primary" /> next to a file to explain it instantly.</p>
                    </div>
                  </div>
                )}
                {activePath && loadingFile && (
                  <div className="p-6 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading file…
                  </div>
                )}
                {activePath && !loadingFile && fileContent !== null && (
                  <SyntaxHighlighter
                    language={langFromPath(activePath)}
                    style={vscDarkPlus}
                    customStyle={{ margin: 0, padding: "16px", background: "transparent", fontSize: 12.5 }}
                    showLineNumbers wrapLongLines={false}
                  >
                    {fileContent}
                  </SyntaxHighlighter>
                )}
              </div>
            </div>

            <div className="rounded-xl glass shadow-soft flex flex-col min-h-[400px] max-h-[75vh]">
              <div className="h-10 px-4 border-b border-border/70 flex items-center gap-2 text-xs">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="font-semibold">AI explanation</span>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
                {!activePath && (
                  <p className="text-xs text-muted-foreground">Click the <Sparkles className="inline h-3 w-3 text-primary" /> icon next to any file in the tree to explain it.</p>
                )}
                {activePath && !explanation && !explaining && (
                  <p className="text-xs text-muted-foreground">Click <em>Explain with AI</em> to analyze <span className="font-mono">{activePath.split("/").pop()}</span>.</p>
                )}
                {explaining && (
                  <div className="space-y-2">
                    {jobStatus && (
                      <div className="text-[11px] text-muted-foreground space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="uppercase tracking-wide">{jobStatus.status}</span>
                          <span>{jobStatus.progress}%</span>
                        </div>
                        {jobStatus.message && <p className="font-mono">{jobStatus.message}</p>}
                        <div className="h-1 w-full rounded bg-muted overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${jobStatus.progress}%` }} />
                        </div>
                      </div>
                    )}
                    <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-full rounded bg-muted animate-pulse" />
                    <div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                  </div>
                )}
                {explanation && <Markdown content={explanation} />}
              </div>
              <div className="p-3 border-t border-border/70">
                <button onClick={onExplain} disabled={!activePath || !fileContent || explaining}
                  className="w-full h-9 rounded-lg text-sm font-medium text-primary-foreground inline-flex items-center justify-center gap-2 disabled:opacity-50 transition hover:opacity-90"
                  style={{ background: "var(--gradient-primary)" }}>
                  {explaining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Re-explain with AI
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

const BINARY_EXT = new Set([
  "png","jpg","jpeg","gif","webp","ico","bmp","tiff","pdf","zip","tar","gz","rar","7z",
  "mp3","mp4","mov","avi","webm","wav","ogg","flac","ttf","otf","woff","woff2","eot",
  "exe","dll","so","dylib","class","jar","wasm","bin","lockb",
]);
function isBinaryOrUnsupported(path: string, content: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (BINARY_EXT.has(ext)) return true;
  if (content.indexOf("\u0000") !== -1) return true;
  return false;
}

function TreeNode({
  node, depth, active, onPick, onExplain, onLoadFolder, lazy, filter,
}: {
  node: Node; depth: number; active: string | null;
  onPick: (p: string) => void;
  onExplain: (p: string) => void;
  onLoadFolder: (n: Node) => void;
  lazy: boolean;
  filter: string;
}) {
  const [open, setOpen] = useState(depth < 1);
  const matches = !filter || node.path.toLowerCase().includes(filter);
  if (node.type === "blob") {
    if (!matches) return null;
    const isActive = active === node.path;
    return (
      <div
        className={`group w-full flex items-center gap-1.5 pr-1 rounded-md text-xs font-mono transition ${
          isActive ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "hover:bg-secondary/60 text-foreground/85"
        }`}
      >
        <button onClick={() => onPick(node.path)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left py-1 pl-2"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <FileCode2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onExplain(node.path); }}
          title="Explain with AI"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition shrink-0 p-1 rounded hover:bg-primary/20 text-primary"
        >
          <Sparkles className="h-3 w-3" />
        </button>
      </div>
    );
  }
  const visibleChildren = filter
    ? node.children?.filter((c) => containsMatch(c, filter))
    : node.children;
  if (filter && !containsMatch(node, filter)) return null;
  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && lazy && node.sha && !node.loaded && !node.loading) {
      onLoadFolder(node);
    }
  };
  return (
    <div>
      <button onClick={handleToggle}
        className="w-full text-left flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono hover:bg-secondary/60 text-foreground/90"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}>
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <Folder className="h-3 w-3 text-primary/80" />
        <span className="truncate">{node.name}</span>
        {node.loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
      </button>
      {open && visibleChildren?.map((c) => (
        <TreeNode
          key={c.path} node={c} depth={depth + 1} active={active}
          onPick={onPick} onExplain={onExplain} onLoadFolder={onLoadFolder}
          lazy={lazy} filter={filter}
        />
      ))}
    </div>
  );
}

function containsMatch(n: Node, filter: string): boolean {
  if (n.path.toLowerCase().includes(filter)) return true;
  return !!n.children?.some((c) => containsMatch(c, filter));
}