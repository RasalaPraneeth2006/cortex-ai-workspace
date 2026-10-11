import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const [repos, docs, chunks, workspaceFiles, jobsAll, jobsRecent, reposRecent] = await Promise.all([
      supabaseAdmin.from("gh_repo_cache").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("ai_explain_cache").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("repo_chunks" as never).select("id", { count: "exact", head: true }),
      supabaseAdmin.from("workspace_files").select("id", { count: "exact", head: true }).eq("created_by", userId),
      supabaseAdmin.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabaseAdmin
        .from("jobs")
        .select("id, kind, target, status, message, updated_at, created_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabaseAdmin
        .from("gh_repo_cache")
        .select("owner, repo, ref, default_branch, fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(6),
    ]);

    return {
      counts: {
        repos: repos.count ?? 0,
        docs: docs.count ?? 0,
        chunks: chunks.count ?? 0,
        workspaceFiles: workspaceFiles.count ?? 0,
        aiQueries: jobsAll.count ?? 0,
      },
      recentJobs: (jobsRecent.data ?? []) as Array<{
        id: string; kind: string; target: string; status: string; message: string | null; updated_at: string; created_at: string;
      }>,
      recentRepos: (reposRecent.data ?? []) as Array<{
        owner: string; repo: string; ref: string; default_branch: string; fetched_at: string;
      }>,
    };
  });

export const listGeneratedDocs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("ai_explain_cache")
      .select("id, path, language, created_at, explanation")
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => ({
      id: d.id,
      path: d.path,
      language: d.language,
      created_at: d.created_at,
      preview: (d.explanation ?? "").slice(0, 220),
      chars: (d.explanation ?? "").length,
    }));
  });

export const getDocContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("ai_explain_cache")
      .select("id, path, language, explanation, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Doc not found");
    return row;
  });

export const getRepoInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    ref: z.string().max(100).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let ref = data.ref;
    if (!ref) {
      const { data: latest } = await supabaseAdmin
        .from("gh_repo_cache")
        .select("ref, fetched_at")
        .eq("owner", data.owner).eq("repo", data.repo)
        .order("fetched_at", { ascending: false }).limit(1).maybeSingle();
      ref = latest?.ref ?? "main";
    }

    const { data: repoRow } = await supabaseAdmin
      .from("gh_repo_cache")
      .select("data, default_branch, fetched_at")
      .eq("owner", data.owner).eq("repo", data.repo).eq("ref", ref)
      .maybeSingle();

    const tree = ((repoRow?.data as { tree?: Array<{ path: string; type: string; size?: number }> })?.tree ?? []);
    const files = tree.filter((n) => n.type === "blob");
    const langMap: Record<string, number> = {};
    for (const f of files) {
      const ext = f.path.split(".").pop()?.toLowerCase() ?? "other";
      langMap[ext] = (langMap[ext] ?? 0) + 1;
    }
    const languages = Object.entries(langMap).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([ext, count]) => ({ ext, count }));

    const [chunks, cached] = await Promise.all([
      supabaseAdmin.from("repo_chunks" as never).select("id", { count: "exact", head: true })
        .eq("owner", data.owner).eq("repo", data.repo).eq("ref", ref),
      supabaseAdmin.from("ai_explain_cache").select("id", { count: "exact", head: true })
        .ilike("path", `${data.owner}/${data.repo}%`),
    ]);

    return {
      owner: data.owner, repo: data.repo, ref,
      defaultBranch: repoRow?.default_branch ?? null,
      fetchedAt: repoRow?.fetched_at ?? null,
      totals: {
        files: files.length,
        folders: tree.filter((n) => n.type === "tree").length,
        totalBytes: files.reduce((s, f) => s + (f.size ?? 0), 0),
        indexedChunks: chunks.count ?? 0,
        explanations: cached.count ?? 0,
      },
      languages,
      hasCache: !!repoRow,
    };
  });

export const generateRepoReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    ref: z.string().max(100).optional(),
    kind: z.enum(["summary", "architecture"]),
  }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let ref = data.ref;
    if (!ref) {
      const { data: latest } = await supabaseAdmin
        .from("gh_repo_cache")
        .select("ref").eq("owner", data.owner).eq("repo", data.repo)
        .order("fetched_at", { ascending: false }).limit(1).maybeSingle();
      ref = latest?.ref ?? "main";
    }

    const { data: repoRow } = await supabaseAdmin
      .from("gh_repo_cache").select("data, default_branch")
      .eq("owner", data.owner).eq("repo", data.repo).eq("ref", ref).maybeSingle();
    if (!repoRow) throw new Error("Repository not analyzed yet. Analyze it on the Repository page first.");

    const tree = ((repoRow.data as { tree?: Array<{ path: string; type: string; size?: number }> }).tree ?? []);
    const files = tree.filter((n) => n.type === "blob");
    const topPaths = files.slice(0, 60).map((f) => f.path).join("\n");
    const langMap: Record<string, number> = {};
    for (const f of files) {
      const ext = f.path.split(".").pop()?.toLowerCase() ?? "other";
      langMap[ext] = (langMap[ext] ?? 0) + 1;
    }
    const langs = Object.entries(langMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([e, c]) => `${e}=${c}`).join(", ");

    const prompt = data.kind === "summary"
      ? `Write a concise Markdown "Repository summary report" for ${data.owner}/${data.repo}@${ref}. Cover: purpose, tech stack, main modules, key entry points, and 3 recommendations. Total ~450 words.`
      : `Write a Markdown "Architecture overview" for ${data.owner}/${data.repo}@${ref}. Cover: high-level components, data flow, layering, external dependencies, and possible ASCII diagram. ~600 words.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are Cortex, an expert software architect. Output only Markdown." },
          { role: "user", content: `${prompt}\n\nFile listing (partial):\n${topPaths}\n\nLanguage distribution: ${langs}\nTotal files: ${files.length}` },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Rate limit reached. Please wait and try again.");
      if (res.status === 402) throw new Error("AI credits exhausted.");
      throw new Error(`AI gateway error (${res.status}): ${t.slice(0, 200)}`);
    }
    const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const md = j.choices?.[0]?.message?.content ?? "# Report\n\n(no content)";
    return { markdown: md, filename: `${data.owner}-${data.repo}-${ref}-${data.kind}.md` };
  });