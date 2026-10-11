import { useState, useRef, useEffect } from "react";
import { MessageSquareCode, X, Send, Sparkles, Loader2 } from "lucide-react";
import { pythonApi } from "@/lib/python-api";
import { Markdown } from "./Markdown";

type Msg = { role: "user" | "assistant"; content: string };

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content: "Hey 👋 I'm **Cortex**. Ask me anything about code or your repo — I'll explain, navigate, or refactor.",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await pythonApi.ai.chat({ messages: next });
      setMsgs([...next, { role: "assistant", content: res.content || "(no response)" }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full flex items-center justify-center text-primary-foreground shadow-elevated ring-glow animate-pulse-glow hover:scale-105 transition"
          style={{ background: "var(--gradient-primary)" }}
          aria-label="Open Cortex AI chat"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[min(380px,calc(100vw-2rem))] h-[min(560px,calc(100vh-3rem))] rounded-2xl glass-strong shadow-elevated flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-12 border-b border-border/70">
            <div className="h-7 w-7 rounded-md flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
              <MessageSquareCode className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold leading-none">Cortex AI</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Always-on dev co-pilot</div>
            </div>
            <button onClick={() => setOpen(false)} className="h-8 w-8 rounded-md hover:bg-secondary transition flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-secondary/80 border border-border rounded-bl-sm"
                  }`}
                >
                  {m.role === "assistant" ? <Markdown content={m.content} /> : m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="p-3 border-t border-border/70 flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask Cortex anything…"
              rows={1}
              className="flex-1 resize-none rounded-lg bg-input/60 border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-32"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-primary-foreground disabled:opacity-40"
              style={{ background: "var(--gradient-primary)" }}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}