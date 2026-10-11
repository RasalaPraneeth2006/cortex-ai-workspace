import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Editor, { loader as monacoLoader } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  FilePlus2,
  FolderPlus,
  Trash2,
  Pencil,
  Save,
  Github,
  Sparkles,
  Wand2,
  Bug,
  Zap,
  BookOpen,
  MessageSquareCode,
  Terminal as TerminalIcon,
  Columns2,
  Square,
  Folder,
  ChevronRight,
  ChevronDown,
  FileCode2,
  Loader2,
  Copy,
  Download,
  Users,
  X,
  GitCommit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Markdown } from "@/components/Markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { aiCodeAction } from "@/lib/editor.functions";
import { pythonApi } from "@/lib/python-api";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/editor")({
  component: EditorPage,
  head: () => ({
    meta: [
      { title: "Code Editor — Cortex" },
      { name: "description", content: "VS Code-style AI code editor with realtime collaboration." },
    ],
  }),
});

type WFile = {
  id: string;
  path: string;
  language: string | null;
  content: string;
  source: string;
  gh_owner: string | null;
  gh_repo: string | null;
  gh_ref: string | null;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
};

function detectLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", scss: "scss", html: "html",
    py: "python", rs: "rust", go: "go", java: "java", c: "c", cpp: "cpp",
    rb: "ruby", php: "php", sh: "shell", yml: "yaml", yaml: "yaml", sql: "sql",
    toml: "ini", xml: "xml",
  };
  return map[ext] ?? "plaintext";
}

monacoLoader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs" },
});

function EditorPage() {
  const { user, loading: authLoading } = useAuth();
  const [files, setFiles] = useState<WFile[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selection, setSelection] = useState<string>("");
  const [aiPanel, setAiPanel] = useState<{ title: string; content: string; mode: "markdown" | "code" } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showTerminal, setShowTerminal] = useState(true);
  const [termHistory, setTermHistory] = useState<{ cmd: string; out: string }[]>([
    { cmd: "", out: "Cortex Workspace Shell — real commands on your workspace files.\nTry: help, ls, ls <dir>, cat <path>, tree, find <term>, wc <path>, stat <path>, rm <path>, echo <text>, clear" },
  ]);
  const [termInput, setTermInput] = useState("");
  const [termBusy, setTermBusy] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [newOpen, setNewOpen] = useState<null | { kind: "file" | "folder"; parent: string }>(null);
  const [newName, setNewName] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importVal, setImportVal] = useState({ owner: "", repo: "", ref: "main", path: "" });
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitRepo, setCommitRepo] = useState<string>("");
  const [commitBranch, setCommitBranch] = useState<string>("");
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [commitSelected, setCommitSelected] = useState<Record<string, boolean>>({});
  const [commitBusy, setCommitBusy] = useState(false);
  const [presence, setPresence] = useState<{ id: string; name: string }[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastBroadcast = useRef<number>(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const callAction = useServerFn(aiCodeAction);

  // Load all workspace files
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("workspace_files")
        .select("*")
        .order("path");
      if (error) { toast.error(error.message); return; }
      setFiles((data ?? []) as WFile[]);
    })();
  }, [user]);

  // Realtime: workspace_files + collab channel
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("editor-room", { config: { presence: { key: user.id } } });
    channelRef.current = ch;

    ch.on("postgres_changes", { event: "*", schema: "public", table: "workspace_files" }, (payload) => {
      setFiles((prev) => {
        if (payload.eventType === "INSERT") {
          const row = payload.new as WFile;
          if (prev.some((f) => f.id === row.id)) return prev;
          return [...prev, row].sort((a, b) => a.path.localeCompare(b.path));
        }
        if (payload.eventType === "UPDATE") {
          const row = payload.new as WFile;
          return prev.map((f) => (f.id === row.id ? { ...f, ...row } : f));
        }
        if (payload.eventType === "DELETE") {
          const row = payload.old as { id: string };
          setOpenIds((o) => o.filter((id) => id !== row.id));
          return prev.filter((f) => f.id !== row.id);
        }
        return prev;
      });
    });

    ch.on("broadcast", { event: "edit" }, ({ payload }) => {
      if (payload.userId === user.id) return;
      // Apply remote edit to file content if we're not actively editing it
      setFiles((prev) => prev.map((f) => f.id === payload.fileId ? { ...f, content: payload.content } : f));
      // If active and not dirty (no local edits), let editor reflect it
      setDirty((d) => {
        if (d[payload.fileId] !== undefined) return d; // user has local edits -> don't clobber
        return d;
      });
    });

    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (payload.userId === user.id) return;
      setTypingUsers((t) => ({ ...t, [payload.userId]: payload.name }));
      setTimeout(() => setTypingUsers((t) => {
        const c = { ...t };
        delete c[payload.userId];
        return c;
      }), 2500);
    });

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState() as Record<string, Array<{ name: string }>>;
      const list: { id: string; name: string }[] = [];
      Object.entries(state).forEach(([id, metas]) => {
        list.push({ id, name: metas[0]?.name ?? "User" });
      });
      setPresence(list);
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ name: user.email?.split("@")[0] ?? "User" });
      }
    });

    return () => { supabase.removeChannel(ch); channelRef.current = null; };
  }, [user]);

  // Build tree structure
  const tree = useMemo(() => {
    type Node = { name: string; path: string; isDir: boolean; file?: WFile; children: Node[] };
    const root: Node = { name: "", path: "", isDir: true, children: [] };
    const dirs = new Map<string, Node>([["", root]]);
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    for (const f of sorted) {
      const parts = f.path.split("/").filter(Boolean);
      let cur = root;
      let acc = "";
      for (let i = 0; i < parts.length; i++) {
        const last = i === parts.length - 1;
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        if (last) {
          cur.children.push({ name: parts[i], path: f.path, isDir: false, file: f, children: [] });
        } else {
          let dir = dirs.get(acc);
          if (!dir) {
            dir = { name: parts[i], path: acc, isDir: true, children: [] };
            cur.children.push(dir);
            dirs.set(acc, dir);
          }
          cur = dir;
        }
      }
    }
    const sortNode = (n: Node) => {
      n.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      n.children.forEach(sortNode);
    };
    sortNode(root);
    return root;
  }, [files]);

  const active = files.find((f) => f.id === activeId) ?? null;
  const activeContent = active ? (dirty[active.id] ?? active.content) : "";

  const openFile = (f: WFile) => {
    setOpenIds((o) => (o.includes(f.id) ? o : [...o, f.id]));
    setActiveId(f.id);
  };

  const closeTab = (id: string) => {
    setOpenIds((o) => o.filter((x) => x !== id));
    if (activeId === id) {
      const remaining = openIds.filter((x) => x !== id);
      setActiveId(remaining[remaining.length - 1] ?? null);
    }
  };

  const doSave = useCallback(async (id: string, content: string) => {
    const { error } = await supabase
      .from("workspace_files")
      .update({ content, updated_by: user?.id ?? null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error("Save failed: " + error.message); return; }
    setDirty((d) => { const c = { ...d }; delete c[id]; return c; });
    setFiles((prev) => prev.map((f) => f.id === id ? { ...f, content } : f));
  }, [user?.id]);

  const onChange = (val: string | undefined) => {
    if (!active) return;
    const v = val ?? "";
    setDirty((d) => ({ ...d, [active.id]: v }));
    // Auto-save (debounced 800ms)
    if (saveTimers.current[active.id]) clearTimeout(saveTimers.current[active.id]);
    saveTimers.current[active.id] = setTimeout(() => doSave(active.id, v), 800);
    // Broadcast edit (throttled 200ms)
    const now = Date.now();
    if (channelRef.current && user && now - lastBroadcast.current > 200) {
      lastBroadcast.current = now;
      channelRef.current.send({
        type: "broadcast",
        event: "edit",
        payload: { fileId: active.id, content: v, userId: user.id },
      });
      channelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: user.id, name: user.email?.split("@")[0] ?? "User" },
      });
    }
  };

  const onMount = (ed: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = ed;
    ed.onDidChangeCursorSelection(() => {
      const sel = ed.getModel()?.getValueInRange(ed.getSelection()!);
      setSelection(sel ?? "");
    });
  };

  const createFileAt = async (parent: string, name: string, isDir: boolean) => {
    if (!user) return;
    if (!name.trim()) return;
    const path = parent ? `${parent}/${name}` : name;
    if (isDir) {
      // Represent folders as a hidden marker file
      const markerPath = `${path}/.gitkeep`;
      const { error } = await supabase.from("workspace_files").insert({
        path: markerPath, language: null, content: "", source: "local", created_by: user.id, updated_by: user.id,
      });
      if (error) toast.error(error.message);
      else setExpanded((e) => ({ ...e, [path]: true }));
    } else {
      const { data, error } = await supabase.from("workspace_files").insert({
        path, language: detectLang(path), content: "", source: "local", created_by: user.id, updated_by: user.id,
      }).select().single();
      if (error) { toast.error(error.message); return; }
      if (data) openFile(data as WFile);
    }
  };

  const renameFile = async (f: WFile) => {
    const next = window.prompt("Rename to (full path):", f.path);
    if (!next || next === f.path) return;
    const { error } = await supabase.from("workspace_files").update({
      path: next, language: detectLang(next), updated_by: user?.id ?? null,
    }).eq("id", f.id);
    if (error) toast.error(error.message);
  };

  const deleteFile = async (f: WFile) => {
    if (!window.confirm(`Delete ${f.path}?`)) return;
    const { error } = await supabase.from("workspace_files").delete().eq("id", f.id);
    if (error) toast.error(error.message);
  };

  const importFromGithub = async () => {
    if (!user) return;
    const { owner, repo, ref, path } = importVal;
    if (!owner || !repo || !path) { toast.error("Owner, repo and path are required"); return; }
    try {
      const r = await pythonApi.github.fetchFile({ owner, repo, ref: ref || "main", path });
      const localPath = `${owner}-${repo}/${path}`;
      // upsert
      const { data: existing } = await supabase.from("workspace_files").select("id").eq("path", localPath).maybeSingle();
      if (existing) {
        await supabase.from("workspace_files").update({ content: r.content, updated_by: user.id }).eq("id", existing.id);
      } else {
        await supabase.from("workspace_files").insert({
          path: localPath, language: detectLang(localPath), content: r.content, source: "github",
          gh_owner: owner, gh_repo: repo, gh_ref: ref || "main",
          created_by: user.id, updated_by: user.id,
        });
      }
      toast.success("Imported from GitHub");
      setImportOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Group GitHub-sourced files by owner/repo/ref for commit & push
  const ghRepos = useMemo(() => {
    const map = new Map<string, { owner: string; repo: string; ref: string; files: WFile[] }>();
    for (const f of files) {
      if (f.source !== "github" || !f.gh_owner || !f.gh_repo || !f.gh_ref) continue;
      const key = `${f.gh_owner}/${f.gh_repo}@${f.gh_ref}`;
      if (!map.has(key)) map.set(key, { owner: f.gh_owner, repo: f.gh_repo, ref: f.gh_ref, files: [] });
      map.get(key)!.files.push(f);
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [files]);

  const openCommitDialog = () => {
    if (ghRepos.length === 0) {
      toast.error("No GitHub-sourced files in workspace. Import from GitHub first.");
      return;
    }
    const activeKey = active && active.source === "github" && active.gh_owner
      ? `${active.gh_owner}/${active.gh_repo}@${active.gh_ref}` : ghRepos[0].key;
    const target = ghRepos.find((r) => r.key === activeKey) ?? ghRepos[0];
    setCommitRepo(target.key);
    setCommitBranch(target.ref);
    setCommitMessage("");
    const sel: Record<string, boolean> = {};
    target.files.forEach((f) => { sel[f.id] = dirty[f.id] !== undefined; });
    setCommitSelected(sel);
    setCommitOpen(true);
  };

  const currentCommitGroup = ghRepos.find((r) => r.key === commitRepo);

  const doCommit = async () => {
    if (!currentCommitGroup) return;
    if (!commitMessage.trim()) { toast.error("Commit message is required"); return; }
    if (!commitBranch.trim()) { toast.error("Branch is required"); return; }
    const chosen = currentCommitGroup.files.filter((f) => commitSelected[f.id]);
    if (chosen.length === 0) { toast.error("Select at least one file"); return; }
    const prefix = `${currentCommitGroup.owner}-${currentCommitGroup.repo}/`;
    const payload = chosen.map((f) => {
      const content = dirty[f.id] ?? f.content;
      const repoPath = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
      return { path: repoPath, content };
    });
    setCommitBusy(true);
    try {
      await Promise.all(chosen.filter((f) => dirty[f.id] !== undefined).map((f) => doSave(f.id, dirty[f.id]!)));
      const r = await pythonApi.github.commitFiles({
        owner: currentCommitGroup.owner,
        repo: currentCommitGroup.repo,
        branch: commitBranch.trim(),
        message: commitMessage.trim(),
        files: payload,
        authorName: user?.email?.split("@")[0],
        authorEmail: user?.email ?? undefined,
      });
      toast.success(`Pushed ${chosen.length} file${chosen.length > 1 ? "s" : ""} to ${currentCommitGroup.owner}/${currentCommitGroup.repo}@${commitBranch}`, {
        action: { label: "View", onClick: () => window.open(r.url, "_blank") },
      });
      setCommitOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCommitBusy(false);
    }
  };

  const runAi = async (action: "generate" | "correct" | "explain" | "refactor" | "optimize" | "comment", prompt?: string) => {
    if (!active && action !== "generate") { toast.error("Open a file first"); return; }
    setAiBusy(true);
    setAiPanel({ title: action.toUpperCase(), content: "Working…", mode: action === "explain" ? "markdown" : "code" });
    try {
      const codeForAi = selection || activeContent;
      const r = await callAction({
        data: {
          action,
          language: active?.language ?? undefined,
          path: active?.path,
          code: codeForAi,
          prompt,
        },
      });
      setAiPanel({ title: action.toUpperCase(), content: r.content, mode: r.mode });
      // For code-mutating actions, offer to apply
      if (r.mode === "code" && active && (action === "correct" || action === "refactor" || action === "optimize" || action === "comment")) {
        if (window.confirm("Apply AI changes to the file?")) {
          setDirty((d) => ({ ...d, [active.id]: r.content }));
          await doSave(active.id, r.content);
        }
      }
      if (r.mode === "code" && action === "generate") {
        if (active && window.confirm("Insert generated code into current file?")) {
          const next = `${activeContent}\n\n${r.content}`;
          setDirty((d) => ({ ...d, [active.id]: next }));
          await doSave(active.id, next);
        }
      }
    } catch (e) {
      setAiPanel({ title: "Error", content: (e as Error).message, mode: "markdown" });
    } finally { setAiBusy(false); }
  };

  const runTerm = async () => {
    if (!termInput.trim()) return;
    const cmd = termInput.trim();
    setTermInput("");
    setTermBusy(true);
    let out = "";
    try {
      const [name, ...rest] = cmd.split(/\s+/);
      const arg = rest.join(" ");
      const norm = (p: string) => p.replace(/^\/+/, "").replace(/\/+$/, "");
      switch (name) {
        case "help":
          out = "Commands: help, ls [dir], cat <path>, tree, find <term>, wc <path>, stat <path>, rm <path>, echo <text>, clear";
          break;
        case "clear":
          setTermHistory([]); setTermBusy(false); return;
        case "echo":
          out = arg; break;
        case "pwd":
          out = "/"; break;
        case "ls": {
          const prefix = norm(arg);
          const inScope = files.filter((f) => prefix === "" || f.path === prefix || f.path.startsWith(prefix + "/"));
          if (inScope.length === 0) { out = `ls: ${arg || "/"}: no such file or directory`; break; }
          const entries = new Set<string>();
          for (const f of inScope) {
            const rel = prefix ? f.path.slice(prefix.length + 1) : f.path;
            if (!rel) continue;
            const seg = rel.split("/")[0];
            entries.add(seg + (rel.includes("/") ? "/" : ""));
          }
          out = [...entries].sort().join("\n") || "(empty)";
          break;
        }
        case "tree": {
          const paths = files.map((f) => f.path).sort();
          out = paths.map((p) => "  ".repeat((p.match(/\//g) ?? []).length) + p.split("/").pop()).join("\n") || "(no files)";
          break;
        }
        case "cat": {
          const p = norm(arg);
          const f = files.find((x) => x.path === p);
          if (!f) { out = `cat: ${arg}: no such file`; break; }
          out = dirty[f.id] ?? f.content;
          break;
        }
        case "wc": {
          const p = norm(arg);
          const f = files.find((x) => x.path === p);
          if (!f) { out = `wc: ${arg}: no such file`; break; }
          const c = dirty[f.id] ?? f.content;
          const lines = c.split("\n").length;
          const words = (c.trim().match(/\S+/g) ?? []).length;
          out = `${lines}\t${words}\t${c.length}\t${p}`;
          break;
        }
        case "stat": {
          const p = norm(arg);
          const f = files.find((x) => x.path === p);
          if (!f) { out = `stat: ${arg}: no such file`; break; }
          out = `path: ${f.path}\nlanguage: ${f.language ?? "plaintext"}\nsource: ${f.source}\nsize: ${(dirty[f.id] ?? f.content).length}\nupdated_at: ${f.updated_at}`;
          break;
        }
        case "find": {
          if (!arg) { out = "find: missing search term"; break; }
          const term = arg.toLowerCase();
          const matches = files.filter((f) => f.path.toLowerCase().includes(term));
          out = matches.length ? matches.map((f) => f.path).join("\n") : "(no matches)";
          break;
        }
        case "rm": {
          const p = norm(arg);
          const f = files.find((x) => x.path === p);
          if (!f) { out = `rm: ${arg}: no such file`; break; }
          const { error } = await supabase.from("workspace_files").delete().eq("id", f.id);
          if (error) { out = `rm: ${error.message}`; break; }
          out = `removed '${p}'`;
          break;
        }
        default:
          out = `${name}: command not found. Type 'help' for available commands.`;
      }
    } catch (e) { out = (e as Error).message; }
    setTermHistory((h) => [...h, { cmd, out }]);
    setTermBusy(false);
  };

  if (authLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!user) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="font-display text-2xl mb-2">Sign in to use the editor</h1>
        <p className="text-muted-foreground mb-4">The AI code editor requires an account so your files and edits sync across devices.</p>
        <Link to="/auth"><Button>Sign in</Button></Link>
      </div>
    );
  }

  const renderTreeNode = (node: { name: string; path: string; isDir: boolean; file?: WFile; children: { name: string; path: string; isDir: boolean; file?: WFile; children: any[] }[] }, depth = 0): React.ReactNode => {
    if (node.isDir && node.path === "") {
      return node.children.map((c) => <div key={c.path}>{renderTreeNode(c, 0)}</div>);
    }
    if (node.isDir) {
      const open = expanded[node.path] ?? depth < 1;
      return (
        <div>
          <div
            className="group flex items-center gap-1 px-2 py-1 hover:bg-muted/50 rounded text-sm cursor-pointer"
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => setExpanded((e) => ({ ...e, [node.path]: !open }))}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Folder className="h-3.5 w-3.5 text-primary" />
            <span className="truncate">{node.name}</span>
            <button
              className="ml-auto opacity-0 group-hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); setNewOpen({ kind: "file", parent: node.path }); setNewName(""); }}
              title="New file here"
            ><FilePlus2 className="h-3 w-3" /></button>
          </div>
          {open && node.children.map((c) => <div key={c.path}>{renderTreeNode(c, depth + 1)}</div>)}
        </div>
      );
    }
    if (node.file?.path.endsWith("/.gitkeep")) return null;
    const f = node.file!;
    const isActive = activeId === f.id;
    return (
      <div
        className={`group flex items-center gap-1 px-2 py-1 rounded text-sm cursor-pointer ${isActive ? "bg-primary/15 text-foreground" : "hover:bg-muted/50"}`}
        style={{ paddingLeft: 8 + depth * 12 + 12 }}
        onClick={() => openFile(f)}
      >
        <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
        {dirty[f.id] !== undefined && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />}
        <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); renameFile(f); }} title="Rename"><Pencil className="h-3 w-3" /></button>
          <button onClick={(e) => { e.stopPropagation(); deleteFile(f); }} title="Delete"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-background text-foreground">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-card/40">
        <Sparkles className="h-4 w-4 text-primary" />
        <h1 className="font-display text-sm mr-3">AI Code Editor</h1>
        <Button size="sm" variant="ghost" onClick={() => { setGenPrompt(""); setGenOpen(true); }} disabled={aiBusy}>
          <Wand2 className="h-3.5 w-3.5 mr-1" /> Generate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => runAi("correct")} disabled={aiBusy || !active}>
          <Bug className="h-3.5 w-3.5 mr-1" /> Correct
        </Button>
        <Button size="sm" variant="ghost" onClick={() => runAi("explain")} disabled={aiBusy || !active}>
          <BookOpen className="h-3.5 w-3.5 mr-1" /> Explain
        </Button>
        <Button size="sm" variant="ghost" onClick={() => runAi("refactor")} disabled={aiBusy || !active}>
          <MessageSquareCode className="h-3.5 w-3.5 mr-1" /> Refactor
        </Button>
        <Button size="sm" variant="ghost" onClick={() => runAi("optimize")} disabled={aiBusy || !active}>
          <Zap className="h-3.5 w-3.5 mr-1" /> Optimize
        </Button>
        <Button size="sm" variant="ghost" onClick={() => runAi("comment")} disabled={aiBusy || !active}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Document
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {presence.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{presence.length} online</span>
            </div>
          )}
          {Object.values(typingUsers).length > 0 && (
            <span className="text-xs text-primary animate-pulse">{Object.values(typingUsers).join(", ")} typing…</span>
          )}
          <Button size="sm" variant="ghost" onClick={() => active && doSave(active.id, activeContent)} disabled={!active}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
          <Button size="sm" variant="ghost" onClick={openCommitDialog} disabled={commitBusy} title="Commit & push GitHub files">
            {commitBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <GitCommit className="h-3.5 w-3.5 mr-1" />} Commit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSplit((s) => !s)}>
            {showSplit ? <Square className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowTerminal((s) => !s)}>
            <TerminalIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* File explorer */}
        <ResizablePanel defaultSize={18} minSize={12} className="bg-card/30">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Explorer</span>
            <div className="flex gap-1">
              <button title="New file" onClick={() => { setNewOpen({ kind: "file", parent: "" }); setNewName(""); }}>
                <FilePlus2 className="h-3.5 w-3.5" />
              </button>
              <button title="New folder" onClick={() => { setNewOpen({ kind: "folder", parent: "" }); setNewName(""); }}>
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
              <button title="Import from GitHub" onClick={() => setImportOpen(true)}>
                <Github className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <ScrollArea className="h-[calc(100%-2.5rem)]">
            <div className="p-1">
              {files.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">
                  No files yet. Create one with the <FilePlus2 className="inline h-3 w-3" /> icon, or import from GitHub.
                </div>
              ) : (
                renderTreeNode(tree as any)
              )}
            </div>
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle />

        {/* Editor + terminal */}
        <ResizablePanel defaultSize={aiPanel ? 52 : 82}>
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={showTerminal ? 70 : 100}>
              {/* Tabs */}
              <div className="flex items-center bg-card/40 border-b border-border h-9 overflow-x-auto scrollbar-thin">
                {openIds.map((id) => {
                  const f = files.find((x) => x.id === id);
                  if (!f) return null;
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-2 px-3 h-full text-xs cursor-pointer border-r border-border ${activeId === id ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setActiveId(id)}
                    >
                      <FileCode2 className="h-3 w-3" />
                      <span>{f.path.split("/").pop()}</span>
                      {dirty[id] !== undefined && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      <button onClick={(e) => { e.stopPropagation(); closeTab(id); }}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                {openIds.length === 0 && (
                  <div className="px-3 text-xs text-muted-foreground">No file open</div>
                )}
              </div>

              {showSplit && active ? (
                <ResizablePanelGroup direction="horizontal">
                  <ResizablePanel defaultSize={50}>
                    <Editor
                      height="100%"
                      theme="vs-dark"
                      path={active.path}
                      language={active.language ?? "plaintext"}
                      value={activeContent}
                      onChange={onChange}
                      onMount={onMount}
                      options={{ fontSize: 13, minimap: { enabled: false }, automaticLayout: true, wordWrap: "on", lineNumbers: "on", scrollBeyondLastLine: false }}
                    />
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={50}>
                    <Editor
                      height="100%"
                      theme="vs-dark"
                      path={active.path + "?b"}
                      language={active.language ?? "plaintext"}
                      value={activeContent}
                      onChange={onChange}
                      options={{ fontSize: 13, minimap: { enabled: false }, automaticLayout: true, wordWrap: "on", lineNumbers: "on", scrollBeyondLastLine: false }}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : active ? (
                <Editor
                  height="100%"
                  theme="vs-dark"
                  path={active.path}
                  language={active.language ?? "plaintext"}
                  value={activeContent}
                  onChange={onChange}
                  onMount={onMount}
                  options={{ fontSize: 13, minimap: { enabled: true }, automaticLayout: true, wordWrap: "on", lineNumbers: "on", scrollBeyondLastLine: false, suggestOnTriggerCharacters: true, quickSuggestions: true, formatOnPaste: true, formatOnType: true }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Open a file from the explorer or create a new one.
                </div>
              )}
            </ResizablePanel>

            {showTerminal && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={30} minSize={15}>
                  <div className="h-full flex flex-col bg-[#0b1220] text-emerald-200 font-mono text-xs">
                    <div className="flex items-center gap-2 px-3 py-1 border-b border-emerald-900/30 text-emerald-300">
                      <TerminalIcon className="h-3 w-3" /> Workspace Shell {termBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                    </div>
                    <ScrollArea className="flex-1 px-3 py-2">
                      {termHistory.map((h, i) => (
                        <div key={i} className="mb-2">
                          {h.cmd && <div className="text-emerald-400">$ {h.cmd}</div>}
                          <pre className="whitespace-pre-wrap">{h.out}</pre>
                        </div>
                      ))}
                    </ScrollArea>
                    <div className="flex items-center gap-2 px-3 py-2 border-t border-emerald-900/30">
                      <span className="text-emerald-400">$</span>
                      <input
                        value={termInput}
                        onChange={(e) => setTermInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") runTerm(); }}
                        className="flex-1 bg-transparent outline-none text-emerald-100"
                        placeholder="ls  ·  cat path  ·  find term  ·  help"
                        disabled={termBusy}
                      />
                    </div>
                  </div>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </ResizablePanel>

        {aiPanel && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={20}>
              <div className="h-full flex flex-col border-l border-border">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-medium">{aiPanel.title}</span>
                  {aiBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(aiPanel.content)}>
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      const blob = new Blob([aiPanel.content], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = `${aiPanel.title.toLowerCase()}.md`; a.click();
                      URL.revokeObjectURL(url);
                    }}>
                      <Download className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAiPanel(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <ScrollArea className="flex-1 p-4">
                  {aiPanel.mode === "markdown" ? (
                    <Markdown content={aiPanel.content} />
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap font-mono">{aiPanel.content}</pre>
                  )}
                </ScrollArea>
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* New file/folder dialog */}
      <Dialog open={!!newOpen} onOpenChange={(o) => !o && setNewOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New {newOpen?.kind}</DialogTitle>
          </DialogHeader>
          <Input
            placeholder={newOpen?.kind === "file" ? "name.tsx" : "folder-name"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newOpen) { createFileAt(newOpen.parent, newName, newOpen.kind === "folder"); setNewOpen(null); }}}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewOpen(null)}>Cancel</Button>
            <Button onClick={() => { if (newOpen) { createFileAt(newOpen.parent, newName, newOpen.kind === "folder"); setNewOpen(null); }}}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate code</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Describe what to generate (e.g. 'a React hook that debounces a value')"
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Button>
            <Button onClick={() => { setGenOpen(false); runAi("generate", genPrompt); }} disabled={!genPrompt.trim()}>
              <Wand2 className="h-4 w-4 mr-1" /> Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from GitHub */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import file from GitHub</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input placeholder="owner" value={importVal.owner} onChange={(e) => setImportVal({ ...importVal, owner: e.target.value })} />
            <Input placeholder="repo" value={importVal.repo} onChange={(e) => setImportVal({ ...importVal, repo: e.target.value })} />
            <Input placeholder="branch (default: main)" value={importVal.ref} onChange={(e) => setImportVal({ ...importVal, ref: e.target.value })} />
            <Input placeholder="path/to/file.ts" value={importVal.path} onChange={(e) => setImportVal({ ...importVal, path: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={importFromGithub}><Github className="h-4 w-4 mr-1" /> Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Commit & push */}
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Commit & push to GitHub</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Repository</label>
              <select
                className="mt-1 w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                value={commitRepo}
                onChange={(e) => {
                  const key = e.target.value;
                  setCommitRepo(key);
                  const g = ghRepos.find((r) => r.key === key);
                  if (g) {
                    setCommitBranch(g.ref);
                    const sel: Record<string, boolean> = {};
                    g.files.forEach((f) => { sel[f.id] = dirty[f.id] !== undefined; });
                    setCommitSelected(sel);
                  }
                }}
              >
                {ghRepos.map((r) => (
                  <option key={r.key} value={r.key}>{r.owner}/{r.repo} ({r.ref})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Branch</label>
              <Input value={commitBranch} onChange={(e) => setCommitBranch(e.target.value)} placeholder="main" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Commit message</label>
              <Textarea value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} rows={2} placeholder="Update files via Cortex" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Files to include</label>
                {currentCommitGroup && (
                  <div className="flex gap-2 text-xs">
                    <button className="text-primary hover:underline" onClick={() => {
                      const sel: Record<string, boolean> = {};
                      currentCommitGroup.files.forEach((f) => { sel[f.id] = true; });
                      setCommitSelected(sel);
                    }}>All</button>
                    <button className="text-primary hover:underline" onClick={() => {
                      const sel: Record<string, boolean> = {};
                      currentCommitGroup.files.forEach((f) => { sel[f.id] = dirty[f.id] !== undefined; });
                      setCommitSelected(sel);
                    }}>Dirty only</button>
                    <button className="text-primary hover:underline" onClick={() => setCommitSelected({})}>None</button>
                  </div>
                )}
              </div>
              <ScrollArea className="h-48 rounded border border-border">
                <div className="p-2 space-y-1">
                  {currentCommitGroup?.files.map((f) => {
                    const prefix = `${currentCommitGroup.owner}-${currentCommitGroup.repo}/`;
                    const repoPath = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
                    const isDirty = dirty[f.id] !== undefined;
                    return (
                      <label key={f.id} className="flex items-center gap-2 text-sm hover:bg-muted/40 rounded px-1.5 py-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!commitSelected[f.id]}
                          onChange={(e) => setCommitSelected((s) => ({ ...s, [f.id]: e.target.checked }))}
                        />
                        <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate flex-1">{repoPath}</span>
                        {isDirty && <span className="text-[10px] text-primary">modified</span>}
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCommitOpen(false)} disabled={commitBusy}>Cancel</Button>
            <Button onClick={doCommit} disabled={commitBusy}>
              {commitBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <GitCommit className="h-4 w-4 mr-1" />}
              Commit & push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}