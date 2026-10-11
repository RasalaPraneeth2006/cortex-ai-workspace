import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Markdown } from "@/components/Markdown";
import { pythonApi } from "@/lib/python-api";
import { Send, Sparkles, Loader2, MessageSquareCode, Bot, User } from "lucide-react";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "AI Chat — Cortex" },
      { name: "description", content: "Ask Cortex anything about your code, architecture, or repository." },
    ],
  }),
  component: ChatPage,
});

type Msg = { role: "user" | "assistant"; content: string };

const suggestions = [
  "Explain the difference between Server Components and Client Components.",
  "Write a TypeScript debounce hook with cleanup.",
  "How would you structure a multi-tenant SaaS database?",
  "Refactor this for readability: function add(a,b){return a+b}",
];

function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const res = await pythonApi.ai.chat({ messages: next });
      setMsgs([...next, { role: "assistant", content: res.content || "(no response)" }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  };

  return (
    <AppLayout>
      <div className="grid-bg min-h-full">
        <div className="px-4 md:px-6 py-6 max-w-4xl mx-auto h-[calc(100vh-4rem)] flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquareCode className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-display font-semibold">AI Q/A Assistant</h1>
            <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">powered by Lovable AI</span>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin rounded-xl glass shadow-soft p-4 md:p-6 space-y-5">
            {msgs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center py-10">
                <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-primary-foreground mb-4 ring-glow"
                     style={{ background: "var(--gradient-primary)" }}>
                  <Sparkles className="h-7 w-7" />
                </div>
                <h2 className="text-2xl font-display font-semibold">How can I help?</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Ask about syntax, architecture, debugging — or paste code for review.
                </p>
                <div className="mt-6 grid sm:grid-cols-2 gap-2 max-w-2xl w-full">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => send(s)}
                      className="text-left text-xs p-3 rounded-lg border border-border bg-secondary/40 hover:bg-secondary hover:border-primary/40 transition">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`h-8 w-8 shrink-0 rounded-md flex items-center justify-center ${
                  m.role === "assistant" ? "text-primary-foreground" : "bg-secondary border border-border"
                }`} style={m.role === "assistant" ? { background: "var(--gradient-primary)" } : undefined}>
                  {m.role === "assistant" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">
                    {m.role === "assistant" ? "Cortex" : "You"}
                  </div>
                  {m.role === "assistant" ? <Markdown content={m.content} /> :
                    <div className="text-sm whitespace-pre-wrap">{m.content}</div>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pl-11">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(); }}
            className="mt-3 flex items-end gap-2 rounded-xl glass-strong p-2 shadow-soft">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask anything…  (Shift+Enter for newline)"
              rows={1}
              className="flex-1 resize-none bg-transparent px-3 py-2 text-sm focus:outline-none max-h-40"
            />
            <button type="submit" disabled={busy || !input.trim()}
              className="h-10 w-10 rounded-lg flex items-center justify-center text-primary-foreground disabled:opacity-40 transition hover:opacity-90"
              style={{ background: "var(--gradient-primary)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}