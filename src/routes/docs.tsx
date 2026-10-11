import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { pythonApi } from "@/lib/python-api";
import { FileText, Download, Sparkles, Clock, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/Markdown";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation — Cortex" },
      { name: "description", content: "AI-generated Markdown documentation for your indexed files." },
    ],
  }),
  component: DocsPage,
});

type Doc = Awaited<ReturnType<typeof pythonApi.stats.listDocs>>[number];

function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return `${d}d ago`;
}

function DocsPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [open, setOpen] = useState<{ path: string; language: string | null; explanation: string } | null>(null);
  const [openBusy, setOpenBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    pythonApi.stats.listDocs().then((d) => { if (alive) setDocs(d); }).catch(() => { if (alive) setDocs([]); });
    return () => { alive = false; };
  }, []);

  const openDoc = async (id: string) => {
    setOpenBusy(true);
    try {
      const r = await pythonApi.stats.getDoc({ id });
      setOpen({ path: r.path, language: r.language ?? null, explanation: r.explanation });
    } catch (e) { toast.error((e as Error).message); }
    finally { setOpenBusy(false); }
  };

  const download = (path: string, content: string) => {
    const name = path.replace(/[^a-zA-Z0-9_.-]+/g, "_") + ".md";
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="grid-bg min-h-full">
        <div className="px-4 md:px-8 py-6 max-w-[1200px] mx-auto space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Generated documentation</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-display font-semibold">Your AI-generated docs</h1>
              <p className="text-sm text-muted-foreground mt-1">Every file you ask Cortex to explain is stored here as reusable Markdown.</p>
            </div>
            <Link to="/repository" className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-medium text-primary-foreground transition hover:opacity-90" style={{ background: "var(--gradient-primary)" }}>
              <Sparkles className="h-4 w-4" /> Generate new
            </Link>
          </div>

          {docs === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading docs…</div>
          ) : docs.length === 0 ? (
            <div className="rounded-xl glass p-8 text-center text-sm text-muted-foreground">
              No documentation yet. Open <Link to="/repository" className="text-primary hover:underline">Repository</Link>, pick a file, and click the sparkle to generate one.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {docs.map((d) => (
                <article key={d.id} className="rounded-xl glass shadow-soft p-5 hover:ring-1 hover:ring-primary/40 transition">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary">{d.language ?? "text"}</span>
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {timeAgo(d.created_at)}</span>
                  </div>
                  <h2 className="mt-3 text-sm font-mono truncate" title={d.path}>{d.path}</h2>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{d.preview}…</p>
                  <p className="text-[10px] text-muted-foreground mt-2 font-mono">{d.chars.toLocaleString()} chars</p>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => openDoc(d.id)}
                      disabled={openBusy}
                      className="flex-1 h-9 rounded-lg text-xs font-medium border border-border bg-secondary/60 hover:bg-secondary transition disabled:opacity-50"
                    >Open</button>
                    <button
                      onClick={async () => {
                        try { const r = await pythonApi.stats.getDoc({ id: d.id }); download(r.path, r.explanation); }
                        catch (e) { toast.error((e as Error).message); }
                      }}
                      className="h-9 px-3 rounded-lg text-xs font-medium border border-border bg-secondary/60 hover:bg-secondary transition inline-flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" /> .md
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm truncate flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{open?.path}</span>
              <button className="ml-auto" onClick={() => setOpen(null)}><X className="h-4 w-4" /></button>
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto pr-2">
            {open && <Markdown content={open.explanation} />}
          </div>
          {open && (
            <div className="pt-3 border-t border-border flex justify-end">
              <button onClick={() => download(open.path, open.explanation)} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-xs border border-border bg-secondary/60 hover:bg-secondary transition">
                <Download className="h-3 w-3" /> Download .md
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}