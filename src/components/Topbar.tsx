import { useState } from "react";
import { Search, Bell, Github } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function Topbar() {
  const [q, setQ] = useState("");
  return (
    <header className="h-16 shrink-0 border-b border-border/70 glass-strong px-4 md:px-6 flex items-center gap-3">
      <div className="flex md:hidden items-center gap-2 mr-1">
        <div className="h-7 w-7 rounded-md flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
          <span className="text-primary-foreground text-xs font-bold">C</span>
        </div>
        <span className="font-display font-semibold text-sm">Cortex</span>
      </div>
      <div className="flex-1 max-w-xl">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search files, functions, snippets…"
            className="w-full h-10 pl-9 pr-16 rounded-lg bg-input/60 border border-border focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm placeholder:text-muted-foreground transition"
          />
          <kbd className="hidden sm:inline-flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            ⌘K
          </kbd>
        </div>
      </div>
      <Link
        to="/repository"
        className="hidden sm:inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-secondary/60 text-xs hover:bg-secondary transition"
      >
        <Github className="h-3.5 w-3.5" />
        Add repo
      </Link>
      <button className="h-9 w-9 rounded-lg border border-border bg-secondary/60 hover:bg-secondary transition flex items-center justify-center">
        <Bell className="h-4 w-4 text-muted-foreground" />
      </button>
      <div className="h-9 w-9 rounded-full ring-2 ring-primary/40" style={{ background: "var(--gradient-accent)" }} />
    </header>
  );
}