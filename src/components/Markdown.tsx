import { useMemo } from "react";

/**
 * Tiny markdown renderer (no extra deps).
 * Supports: headings, bold/italic/inline code, fenced code, lists, paragraphs, links.
 */
export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => render(content), [content]);
  return (
    <div
      className="prose-cortex text-sm leading-relaxed text-foreground/90"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-primary font-mono text-[0.85em]">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-primary hover:underline">$1</a>');
  return out;
}

function render(md: string) {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listBuf: string[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (listBuf.length) {
      out.push('<ul class="my-2 ml-5 list-disc space-y-1">' + listBuf.map((i) => `<li>${inline(i)}</li>`).join("") + "</ul>");
      listBuf = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p class="my-2">${inline(para.join(" "))}</p>`);
      para = [];
    }
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(
          `<pre class="my-3 p-3 rounded-lg bg-[oklch(0.14_0.018_260)] border border-border overflow-x-auto scrollbar-thin"><code class="font-mono text-xs leading-relaxed text-foreground/90">${escapeHtml(
            codeBuf.join("\n"),
          )}</code></pre>`,
        );
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const lvl = h[1].length;
      const sizes = ["text-xl", "text-lg", "text-base", "text-sm"];
      out.push(`<h${lvl} class="mt-4 mb-2 font-display font-semibold ${sizes[lvl - 1]}">${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      listBuf.push(li[1]);
      continue;
    }
    if (line.trim() === "") {
      flushPara(); flushList();
      continue;
    }
    para.push(line);
  }
  flushPara(); flushList();
  if (inCode && codeBuf.length) {
    out.push(
      `<pre class="my-3 p-3 rounded-lg bg-[oklch(0.14_0.018_260)] border border-border overflow-x-auto scrollbar-thin"><code class="font-mono text-xs">${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
    );
  }
  return out.join("");
}