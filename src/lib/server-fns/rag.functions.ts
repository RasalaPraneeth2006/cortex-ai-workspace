import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchRepo, fetchFile } from "./github.functions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Repo-aware RAG using Postgres full-text search.
 * - indexRepo: chunks indexable text files and upserts into repo_chunks
 * - searchRepo: ranked retrieval via search_repo_chunks RPC
 * - ragChat: retrieves top chunks and asks Lovable AI grounded in them
 */

const TEXT_EXT = new Set([
  "ts","tsx","js","jsx","mjs","cjs","json","md","mdx","txt","yml","yaml","toml","ini","env",
  "py","rb","go","rs","java","kt","swift","c","h","cpp","hpp","cs","php","sh","bash","zsh",
  "css","scss","less","html","vue","svelte","sql","graphql","gql","prisma","dockerfile","makefile",
]);
const SKIP_DIR = new Set(["node_modules",".git","dist","build",".next",".turbo","coverage",".cache","out","target","vendor",".venv","__pycache__"]);
const MAX_FILE_BYTES = 120_000;
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 200;
const MAX_FILES_PER_RUN = 200;

function langOf(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith("dockerfile") || lower.includes("/dockerfile")) return "dockerfile";
  if (lower.endsWith("makefile") || lower.includes("/makefile")) return "makefile";
  const ext = lower.split(".").pop() ?? "";
  return ext;
}
function isIndexable(path: string, size?: number): boolean {
  const parts = path.split("/");
  if (parts.some((p) => SKIP_DIR.has(p))) return false;
  if (size != null && size > MAX_FILE_BYTES) return false;
  const lang = langOf(path);
  return TEXT_EXT.has(lang);
}
function chunk(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + CHUNK_CHARS));
    if (i + CHUNK_CHARS >= text.length) break;
    i += CHUNK_CHARS - CHUNK_OVERLAP;
  }
  return chunks.length ? chunks : [""];
}

const IndexInput = z.object({
  owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  ref: z.string().max(100).optional(),
  jobId: z.string().uuid().optional(),
});

async function update(jobId: string | undefined, patch: Record<string, unknown>) {
  if (!jobId) return;
  await supabaseAdmin.from("jobs" as never).update(patch as never).eq("id", jobId);
}

export const indexRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IndexInput.parse(d))
  .handler(async ({ data }) => {
    const meta = await fetchRepo({ data: { owner: data.owner, repo: data.repo, ref: data.ref } });
    const ref = meta.defaultBranch;

    const candidates = meta.tree
      .filter((t) => t.type === "blob" && isIndexable(t.path, t.size))
      .slice(0, MAX_FILES_PER_RUN);

    await update(data.jobId, { progress: 10, message: `Indexing ${candidates.length} files…` });

    let done = 0;
    let chunksWritten = 0;
    for (const file of candidates) {
      try {
        const f = await fetchFile({ data: { owner: data.owner, repo: data.repo, ref, path: file.path } });
        const text = (f.content || "").trim();
        if (!text) { done++; continue; }
        const pieces = chunk(text);
        // Replace prior chunks for this file
        await supabaseAdmin
          .from("repo_chunks" as never)
          .delete()
          .eq("owner", data.owner).eq("repo", data.repo).eq("ref", ref).eq("path", file.path);
        const rows = pieces.map((content, idx) => ({
          owner: data.owner,
          repo: data.repo,
          ref,
          path: file.path,
          language: langOf(file.path),
          chunk_index: idx,
          content,
          token_count: Math.ceil(content.length / 4),
        }));
        if (rows.length) {
          const { error } = await supabaseAdmin.from("repo_chunks" as never).insert(rows as never);
          if (!error) chunksWritten += rows.length;
        }
      } catch {
        // skip individual file failures
      }
      done++;
      if (done % 10 === 0 || done === candidates.length) {
        await update(data.jobId, {
          progress: Math.min(95, 10 + Math.round((done / Math.max(1, candidates.length)) * 85)),
          message: `Indexed ${done}/${candidates.length} files (${chunksWritten} chunks)`,
        });
      }
    }

    await update(data.jobId, {
      status: "done",
      progress: 100,
      message: `Indexed ${done} files, ${chunksWritten} chunks on ${ref}.`,
      result: { files: done, chunks: chunksWritten, ref },
    });

    return { ref, files: done, chunks: chunksWritten };
  });

const SearchInput = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  ref: z.string().min(1).max(100),
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(20).default(8),
});

export type RagHit = {
  path: string;
  language: string | null;
  chunk_index: number;
  content: string;
  rank: number;
};

export const searchRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SearchInput.parse(d))
  .handler(async ({ data }): Promise<{ hits: RagHit[] }> => {
    const { data: rows, error } = await supabaseAdmin.rpc("search_repo_chunks" as never, {
      _owner: data.owner,
      _repo: data.repo,
      _ref: data.ref,
      _query: data.query,
      _limit: data.limit,
    } as never);
    if (error) throw new Error(error.message);
    return { hits: (rows ?? []) as RagHit[] };
  });

const RagChatInput = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  ref: z.string().min(1).max(100),
  question: z.string().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(["user","assistant"]),
    content: z.string().min(1).max(8000),
  })).max(20).default([]),
});

export const ragChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RagChatInput.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const { hits } = await searchRepo({ data: {
      owner: data.owner, repo: data.repo, ref: data.ref, query: data.question, limit: 8,
    }});

    const context = hits.map((h, i) =>
      `[#${i+1}] ${h.path} (chunk ${h.chunk_index})\n\`\`\`${h.language ?? ""}\n${h.content.slice(0, 1600)}\n\`\`\``
    ).join("\n\n");

    const system = `You are Cortex, a repository-aware AI engineer. Answer the user's question using ONLY the provided code excerpts when possible. Cite sources inline as [#1], [#2] matching the excerpt numbers. If the excerpts are insufficient, say so and suggest which file(s) to inspect. Format answers in Markdown.`;
    const userMsg = hits.length
      ? `Repository: ${data.owner}/${data.repo}@${data.ref}\n\nCode excerpts:\n\n${context}\n\n---\nQuestion: ${data.question}`
      : `Repository: ${data.owner}/${data.repo}@${data.ref}\n\nNo indexed excerpts matched the query. Answer from general knowledge but warn that the repo wasn't indexed for this query.\n\nQuestion: ${data.question}`;

    const messages = [
      { role: "system", content: system },
      ...data.history,
      { role: "user", content: userMsg },
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Rate limit reached. Wait and retry.");
      if (res.status === 402) throw new Error("AI credits exhausted.");
      throw new Error(`AI error (${res.status}): ${t.slice(0,200)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string }}> };
    const answer = json.choices?.[0]?.message?.content ?? "";
    const sources = hits.map((h, i) => ({ n: i+1, path: h.path, chunk_index: h.chunk_index, rank: h.rank }));
    return { answer, sources };
  });

const StatsInput = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  ref: z.string().max(100).optional(),
});

export const repoIndexStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatsInput.parse(d))
  .handler(async ({ data }) => {
    let q = supabaseAdmin.from("repo_chunks" as never).select("path, indexed_at", { count: "exact" })
      .eq("owner", data.owner).eq("repo", data.repo);
    if (data.ref) q = q.eq("ref", data.ref);
    const { data: rows, count } = await q.limit(1000);
    const files = new Set((rows as Array<{ path: string }> | null)?.map((r) => r.path) ?? []).size;
    const lastIndexedAt = (rows as Array<{ indexed_at: string }> | null)?.reduce<string | null>(
      (a, r) => (!a || r.indexed_at > a ? r.indexed_at : a), null);
    return { chunks: count ?? 0, files, lastIndexedAt };
  });
