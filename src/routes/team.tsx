import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Hash, Plus, Send, Paperclip, Loader2, LogOut, AtSign, FileText, Image as ImageIcon, X, Link2, Check,
} from "lucide-react";

export const Route = createFileRoute("/team")({
  validateSearch: z.object({ invite: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Team Chat — Cortex" },
      { name: "description", content: "Real-time team chat with mentions and file sharing for code discussions." },
    ],
  }),
  component: TeamPage,
});

type Channel = { id: string; name: string; topic: string | null; created_by: string | null };
type Profile = { id: string; username: string; display_name: string; avatar_url: string | null };
type Message = {
  id: string; channel_id: string; user_id: string; content: string;
  attachment_url: string | null; attachment_name: string | null;
  attachment_type: string | null; attachment_size: number | null;
  mentions: string[]; created_at: string;
};

function TeamPage() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { invite } = Route.useSearch();

  useEffect(() => {
    if (!loading && !user) {
      const target = invite ? `/team?invite=${invite}` : "/team";
      navigate({ to: "/auth", search: { redirect: target } });
    }
  }, [loading, user, navigate, invite]);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [mentionPanel, setMentionPanel] = useState<{ open: boolean; query: string; start: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  // Load channels and memberships
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [{ data: ch }, { data: mem }, { data: pf }] = await Promise.all([
        supabase.from("channels").select("*").order("name"),
        supabase.from("channel_members").select("channel_id").eq("user_id", user.id),
        supabase.from("profiles").select("*"),
      ]);
      setChannels((ch ?? []) as Channel[]);
      setMemberships(new Set((mem ?? []).map((m) => m.channel_id)));
      const map = new Map<string, Profile>();
      (pf ?? []).forEach((p) => map.set(p.id, p as Profile));
      setProfiles(map);
      const general = (ch ?? []).find((c) => c.name === "general") ?? ch?.[0];
      if (invite && (ch ?? []).some((c) => c.id === invite)) setActiveId(invite);
      else if (general) setActiveId(general.id);
    })();
  }, [user, invite]);

  // Honor an invite link: auto-join the invited channel once known
  useEffect(() => {
    if (!user || !invite) return;
    if (!channels.some((c) => c.id === invite)) return;
    if (memberships.has(invite)) { setActiveId(invite); return; }
    void supabase.from("channel_members")
      .insert({ channel_id: invite, user_id: user.id })
      .then(() => {
        setMemberships((s) => new Set(s).add(invite));
        setActiveId(invite);
      });
  }, [user, invite, channels, memberships]);

  async function copyInvite() {
    if (!activeChannel) return;
    const url = `${window.location.origin}/team?invite=${activeChannel.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy invite link:", url);
    }
  }

  // Auto-join general for a smooth first-run experience
  useEffect(() => {
    if (!user || !activeId) return;
    if (memberships.has(activeId)) return;
    const ch = channels.find((c) => c.id === activeId);
    if (ch?.name !== "general") return;
    void supabase.from("channel_members").insert({ channel_id: activeId, user_id: user.id })
      .then(() => setMemberships((s) => new Set(s).add(activeId)));
  }, [user, activeId, memberships, channels]);

  // Load messages for active channel
  useEffect(() => {
    if (!activeId || !memberships.has(activeId)) { setMessages([]); return; }
    void supabase.from("messages").select("*")
      .eq("channel_id", activeId).order("created_at", { ascending: true }).limit(200)
      .then(({ data }) => setMessages((data ?? []) as Message[]));
  }, [activeId, memberships]);

  // Realtime subscription
  useEffect(() => {
    if (!activeId) return;
    const chan = supabase.channel(`messages:${activeId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${activeId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]))
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `channel_id=eq.${activeId}` },
        (payload) => setMessages((prev) => prev.filter((m) => m.id !== (payload.old as Message).id)))
      .subscribe();
    return () => { void supabase.removeChannel(chan); };
  }, [activeId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, activeId]);

  // Listen for new profiles (so mentions of brand-new users resolve)
  useEffect(() => {
    const c = supabase.channel("profiles-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (p) => {
        const row = (p.new ?? p.old) as Profile | null;
        if (!row) return;
        setProfiles((m) => { const n = new Map(m); n.set(row.id, row); return n; });
      }).subscribe();
    return () => { void supabase.removeChannel(c); };
  }, []);

  const profileList = useMemo(() => Array.from(profiles.values()), [profiles]);
  const activeChannel = channels.find((c) => c.id === activeId) ?? null;
  const isMember = activeId ? memberships.has(activeId) : false;

  function onInputChange(v: string) {
    setInput(v);
    const caret = inputRef.current?.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const m = before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
    if (m) setMentionPanel({ open: true, query: m[1].toLowerCase(), start: caret - m[1].length - 1 });
    else setMentionPanel(null);
  }

  function pickMention(p: Profile) {
    if (!mentionPanel) return;
    const before = input.slice(0, mentionPanel.start);
    const after = input.slice((inputRef.current?.selectionStart ?? input.length));
    const next = `${before}@${p.username} ${after}`;
    setInput(next);
    setMentionPanel(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function extractMentionIds(text: string): string[] {
    const ids = new Set<string>();
    const re = /@([a-zA-Z0-9_]+)/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text))) {
      const u = profileList.find((p) => p.username === mm![1]);
      if (u) ids.add(u.id);
    }
    return Array.from(ids);
  }

  async function joinChannel(id: string) {
    if (!user) return;
    const { error } = await supabase.from("channel_members").insert({ channel_id: id, user_id: user.id });
    if (!error) setMemberships((s) => new Set(s).add(id));
  }

  async function createChannel() {
    if (!user || !newName.trim()) return;
    const slug = newName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!slug) return;
    const { data, error } = await supabase.from("channels")
      .insert({ name: slug, created_by: user.id }).select().single();
    if (error) { alert(error.message); return; }
    const ch = data as Channel;
    setChannels((cs) => [...cs, ch].sort((a, b) => a.name.localeCompare(b.name)));
    await supabase.from("channel_members").insert({ channel_id: ch.id, user_id: user.id });
    setMemberships((s) => new Set(s).add(ch.id));
    setActiveId(ch.id);
    setShowNew(false); setNewName("");
  }

  async function uploadFile(file: File): Promise<{ url: string; name: string; type: string; size: number } | null> {
    if (!user) return null;
    if (file.size > 25 * 1024 * 1024) { alert("File too large (max 25MB)"); return null; }
    const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await supabase.storage.from("chat-files").upload(path, file, { contentType: file.type });
    if (error) { alert(error.message); return null; }
    const { data } = supabase.storage.from("chat-files").getPublicUrl(path);
    return { url: data.publicUrl, name: file.name, type: file.type || "application/octet-stream", size: file.size };
  }

  async function send() {
    if (!user || !activeId || !isMember) return;
    const file = fileRef.current?.files?.[0];
    const text = input.trim();
    if (!text && !file) return;
    setSending(true);
    try {
      let attach: Awaited<ReturnType<typeof uploadFile>> = null;
      if (file) attach = await uploadFile(file);
      const { error } = await supabase.from("messages").insert({
        channel_id: activeId, user_id: user.id, content: text,
        mentions: extractMentionIds(text),
        attachment_url: attach?.url ?? null,
        attachment_name: attach?.name ?? null,
        attachment_type: attach?.type ?? null,
        attachment_size: attach?.size ?? null,
      });
      if (error) throw error;
      setInput("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) { alert((e as Error).message); }
    finally { setSending(false); }
  }

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <AppLayout>
      <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] h-[calc(100vh-4rem)] min-h-[500px]">
        {/* Channel list */}
        <aside className="border-r border-border bg-sidebar/40 flex flex-col">
          <div className="px-4 h-12 border-b border-border flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Channels</span>
            <button onClick={() => setShowNew((s) => !s)} className="p-1 rounded hover:bg-secondary">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {showNew && (
            <div className="p-3 border-b border-border space-y-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="channel-name" autoFocus
                className="w-full h-8 px-2 rounded bg-input/60 border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <div className="flex gap-2">
                <button onClick={createChannel}
                  className="flex-1 h-7 rounded text-xs text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>Create</button>
                <button onClick={() => { setShowNew(false); setNewName(""); }} className="h-7 px-2 text-xs rounded hover:bg-secondary">Cancel</button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto scrollbar-thin py-2">
            {channels.map((c) => {
              const active = c.id === activeId;
              const joined = memberships.has(c.id);
              return (
                <button key={c.id} onClick={() => setActiveId(c.id)}
                  className={`w-full px-4 py-1.5 flex items-center gap-2 text-sm transition ${active ? "bg-sidebar-accent text-foreground" : "text-foreground/75 hover:bg-sidebar-accent/50"}`}>
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate flex-1 text-left font-mono">{c.name}</span>
                  {!joined && <span className="text-[9px] uppercase text-muted-foreground">join</span>}
                </button>
              );
            })}
          </div>
          <div className="p-3 border-t border-border flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-semibold">
              {profile?.display_name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <p className="text-xs font-medium truncate">{profile?.display_name ?? user.email}</p>
              <p className="text-[10px] text-muted-foreground truncate">@{profile?.username}</p>
            </div>
            <button onClick={signOut} title="Sign out" className="p-1.5 rounded hover:bg-secondary">
              <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </aside>

        {/* Chat */}
        <section className="flex flex-col min-w-0">
          <header className="h-12 border-b border-border px-5 flex items-center gap-2">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm">{activeChannel?.name ?? "—"}</span>
            {activeChannel?.topic && <span className="ml-3 text-xs text-muted-foreground truncate">{activeChannel.topic}</span>}
            {activeChannel && (
              <button
                onClick={copyInvite}
                title="Copy invite link"
                className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium border border-border bg-secondary/60 hover:bg-secondary transition"
              >
                {copied ? <Check className="h-3 w-3 text-primary" /> : <Link2 className="h-3 w-3" />}
                {copied ? "Link copied" : "Invite link"}
              </button>
            )}
          </header>

          {!activeChannel ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Pick a channel to start chatting.</div>
          ) : !isMember ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm">
              <p className="text-muted-foreground">You're not a member of <span className="font-mono">#{activeChannel.name}</span> yet.</p>
              <button onClick={() => joinChannel(activeChannel.id)}
                className="h-9 px-4 rounded-lg text-sm text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
                Join channel
              </button>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-3">
                {messages.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">No messages yet — say hi 👋</p>
                )}
                {messages.map((m) => {
                  const author = profiles.get(m.user_id);
                  const mine = m.user_id === user.id;
                  const mentionsMe = m.mentions?.includes(user.id);
                  return (
                    <div key={m.id} className={`flex gap-3 group ${mentionsMe ? "bg-primary/5 -mx-2 px-2 py-1.5 rounded-md ring-1 ring-primary/20" : ""}`}>
                      <div className="h-8 w-8 shrink-0 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-semibold">
                        {(author?.display_name ?? "?")[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{author?.display_name ?? "unknown"}</span>
                          <span className="text-[10px] text-muted-foreground">@{author?.username}</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          {mine && (
                            <button onClick={() => supabase.from("messages").delete().eq("id", m.id)}
                              className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] text-muted-foreground hover:text-destructive">delete</button>
                          )}
                        </div>
                        {m.content && (
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {renderWithMentions(m.content, profileList)}
                          </p>
                        )}
                        {m.attachment_url && (
                          <Attachment url={m.attachment_url} name={m.attachment_name ?? "file"} type={m.attachment_type ?? ""} size={m.attachment_size ?? 0} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Composer */}
              <div className="border-t border-border p-3 relative">
                {mentionPanel?.open && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg glass-strong shadow-soft max-h-48 overflow-y-auto">
                    {profileList
                      .filter((p) => p.username.toLowerCase().includes(mentionPanel.query) || p.display_name.toLowerCase().includes(mentionPanel.query))
                      .slice(0, 6)
                      .map((p) => (
                        <button key={p.id} onClick={() => pickMention(p)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary text-left text-sm">
                          <AtSign className="h-3 w-3 text-primary" />
                          <span className="font-medium">{p.display_name}</span>
                          <span className="text-xs text-muted-foreground">@{p.username}</span>
                        </button>
                      ))}
                    {profileList.filter((p) => p.username.toLowerCase().includes(mentionPanel.query)).length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
                    )}
                  </div>
                )}
                <FilePreview fileRef={fileRef} />
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} className="p-2 rounded hover:bg-secondary text-muted-foreground">
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input type="file" ref={fileRef} className="hidden" onChange={() => setInput((s) => s)} />
                  <textarea ref={inputRef} value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !mentionPanel?.open) { e.preventDefault(); void send(); }
                    }}
                    placeholder={`Message #${activeChannel.name}  (use @ to mention)`}
                    rows={1}
                    className="flex-1 max-h-32 resize-none px-3 py-2 rounded-lg bg-input/60 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  <button onClick={send} disabled={sending}
                    className="h-10 px-4 rounded-lg text-sm text-primary-foreground inline-flex items-center gap-2 disabled:opacity-60"
                    style={{ background: "var(--gradient-primary)" }}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </AppLayout>
  );
}

function renderWithMentions(text: string, profiles: Profile[]) {
  const parts: Array<string | { id: string; name: string }> = [];
  const re = /@([a-zA-Z0-9_]+)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const hit = profiles.find((p) => p.username === m![1]);
    if (hit) parts.push({ id: hit.id, name: hit.username });
    else parts.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, i) =>
    typeof p === "string" ? <span key={i}>{p}</span>
      : <span key={i} className="inline-block px-1 rounded bg-primary/20 text-primary font-medium">@{p.name}</span>
  );
}

function Attachment({ url, name, type, size }: { url: string; name: string; type: string; size: number }) {
  const isImage = type.startsWith("image/");
  const kb = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 block">
        <img src={url} alt={name} className="max-h-72 max-w-sm rounded-lg border border-border" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="mt-1.5 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/60 border border-border hover:bg-secondary text-xs max-w-sm">
      <FileText className="h-4 w-4 text-primary shrink-0" />
      <span className="font-mono truncate">{name}</span>
      <span className="text-muted-foreground ml-auto">{kb}</span>
    </a>
  );
}

function FilePreview({ fileRef }: { fileRef: React.RefObject<HTMLInputElement | null> }) {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    const el = fileRef.current; if (!el) return;
    const onChange = () => setFile(el.files?.[0] ?? null);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [fileRef]);
  if (!file) return null;
  const isImg = file.type.startsWith("image/");
  return (
    <div className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/60 border border-border text-xs">
      {isImg ? <ImageIcon className="h-3.5 w-3.5 text-primary" /> : <FileText className="h-3.5 w-3.5 text-primary" />}
      <span className="font-mono truncate max-w-[200px]">{file.name}</span>
      <button onClick={() => { if (fileRef.current) fileRef.current.value = ""; setFile(null); }}
        className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
    </div>
  );
}