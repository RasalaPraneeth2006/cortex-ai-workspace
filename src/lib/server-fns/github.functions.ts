import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getInstallationTokenForOwner } from "@/integrations/github/installation-token.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const REPO_TTL_MS = 1000 * 60 * 60 * 6; // 6h
const FILE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const LARGE_REPO_THRESHOLD = 4000; // files; switch to lazy mode above this

// Fetch with retry on GitHub rate-limits / transient errors
async function ghFetch(url: string, headers: Record<string, string>, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 800 * 2 ** i);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      // GitHub's primary rate-limit signal
      if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
        const waitMs = Math.max(0, Math.min(15000, reset - Date.now()));
        if (waitMs > 0 && i < attempts - 1) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * 2 ** i));
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error("GitHub fetch failed after retries"));
}

async function ghHeaders(owner: string, raw = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
    "User-Agent": "Cortex-Dev-Platform",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const tok = await getInstallationTokenForOwner(owner);
    if (tok) headers.Authorization = `Bearer ${tok.token}`;
  } catch (e) {
    console.warn("[gh] installation token lookup failed for", owner, (e as Error).message);
  }
  return headers;
}

const RepoInput = z.object({
  owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  ref: z.string().max(100).optional(),
  recursive: z.boolean().optional(), // when false → shallow root tree (lazy mode)
});

export type GhTreeItem = {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

export type RepoMeta = {
  owner: string;
  repo: string;
  defaultBranch: string;
  branches: string[];
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  tree: GhTreeItem[];
  truncated: boolean;
  lazy: boolean;
};

export const fetchRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => RepoInput.parse(data))
  .handler(async ({ data }): Promise<RepoMeta> => {
    const headers = await ghHeaders(data.owner);
    const cacheId = `${data.owner}/${data.repo}@${data.ref ?? "_default"}#${data.recursive === false ? "lazy" : "rec"}`;

    // 1. Check persistent cache
    try {
      const { data: row } = await supabaseAdmin
        .from("gh_repo_cache")
        .select("data, fetched_at")
        .eq("id", cacheId)
        .maybeSingle();
      if (row && Date.now() - new Date(row.fetched_at).getTime() < REPO_TTL_MS) {
        return row.data as RepoMeta;
      }
    } catch (e) { console.warn("[cache] gh_repo_cache read failed:", (e as Error).message); }

    const repoRes = await ghFetch(`https://api.github.com/repos/${data.owner}/${data.repo}`, headers);
    if (repoRes.status === 404) throw new Error("Repository not found, or the GitHub App is not installed on this owner. Install the Cortex app on the owner from /access.");
    if (repoRes.status === 401 || repoRes.status === 403) {
      throw new Error("GitHub denied access. The Cortex GitHub App may not be installed on this repository — open /access to install/configure it.");
    }
    if (!repoRes.ok) throw new Error(`GitHub error ${repoRes.status}`);
    const repoJson = (await repoRes.json()) as {
      default_branch: string;
      description: string | null;
      stargazers_count: number;
      forks_count: number;
      language: string | null;
      topics?: string[];
      size?: number;
    };
    const branch = data.ref || repoJson.default_branch;

    // Branches (top 100)
    let branches: string[] = [repoJson.default_branch];
    try {
      const brRes = await ghFetch(`https://api.github.com/repos/${data.owner}/${data.repo}/branches?per_page=100`, headers);
      if (brRes.ok) {
        const list = (await brRes.json()) as Array<{ name: string }>;
        branches = Array.from(new Set([repoJson.default_branch, ...list.map((b) => b.name)]));
      }
    } catch { /* ignore */ }

    // Decide lazy vs recursive (auto)
    let lazy = data.recursive === false;
    let treeJson: { tree: GhTreeItem[]; truncated: boolean } = { tree: [], truncated: false };
    if (!lazy) {
      const treeRes = await ghFetch(`https://api.github.com/repos/${data.owner}/${data.repo}/git/trees/${branch}?recursive=1`, headers);
      if (!treeRes.ok) throw new Error(`Failed to load tree (${treeRes.status})`);
      treeJson = (await treeRes.json()) as { tree: GhTreeItem[]; truncated: boolean };
      // If GitHub truncated OR repo is huge, fall back to lazy mode (shallow root)
      if (treeJson.truncated || treeJson.tree.length > LARGE_REPO_THRESHOLD) {
        lazy = true;
      }
    }
    if (lazy) {
      // Shallow root tree (non-recursive)
      const rootRes = await ghFetch(`https://api.github.com/repos/${data.owner}/${data.repo}/git/trees/${branch}`, headers);
      if (!rootRes.ok) throw new Error(`Failed to load root tree (${rootRes.status})`);
      treeJson = (await rootRes.json()) as { tree: GhTreeItem[]; truncated: boolean };
    }

    const meta: RepoMeta = {
      owner: data.owner,
      repo: data.repo,
      defaultBranch: branch,
      branches,
      description: repoJson.description,
      stars: repoJson.stargazers_count,
      forks: repoJson.forks_count,
      language: repoJson.language,
      topics: repoJson.topics ?? [],
      tree: treeJson.tree,
      truncated: treeJson.truncated,
      lazy,
    };

    try {
      await supabaseAdmin.from("gh_repo_cache").upsert([{
        id: cacheId,
        owner: data.owner,
        repo: data.repo,
        ref: branch,
        default_branch: repoJson.default_branch,
        data: JSON.parse(JSON.stringify(meta)),
        fetched_at: new Date().toISOString(),
      }]);
    } catch (e) { console.warn("[cache] gh_repo_cache write failed:", (e as Error).message); }

    return meta;
  });

// Lazy load a subtree by SHA (or by path via tree+ref)
const SubtreeInput = z.object({
  owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  sha: z.string().min(1).max(100),
  basePath: z.string().max(500).default(""),
});

export const fetchSubtree = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SubtreeInput.parse(data))
  .handler(async ({ data }): Promise<{ items: GhTreeItem[]; truncated: boolean }> => {
    const headers = await ghHeaders(data.owner);
    const res = await ghFetch(`https://api.github.com/repos/${data.owner}/${data.repo}/git/trees/${data.sha}`, headers);
    if (!res.ok) throw new Error(`Failed to load subtree (${res.status})`);
    const json = (await res.json()) as { tree: GhTreeItem[]; truncated: boolean };
    // Re-base paths so they are absolute within the repo
    const items = json.tree.map((t) => ({
      ...t,
      path: data.basePath ? `${data.basePath}/${t.path}` : t.path,
    }));
    return { items, truncated: json.truncated };
  });

const FileInput = z.object({
  owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  ref: z.string().min(1).max(100),
  path: z.string().min(1).max(500),
});

export const fetchFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => FileInput.parse(data))
  .handler(async ({ data }) => {
    const headers = await ghHeaders(data.owner, true);
    const cacheId = `${data.owner}/${data.repo}@${data.ref}:${data.path}`;

    try {
      const { data: row } = await supabaseAdmin
        .from("gh_file_cache")
        .select("content, truncated, fetched_at")
        .eq("id", cacheId)
        .maybeSingle();
      if (row && Date.now() - new Date(row.fetched_at).getTime() < FILE_TTL_MS) {
        return { content: row.content, truncated: row.truncated };
      }
    } catch (e) { console.warn("[cache] gh_file_cache read failed:", (e as Error).message); }

    const res = await ghFetch(`https://api.github.com/repos/${data.owner}/${data.repo}/contents/${encodeURIComponent(
        data.path,
      ).replace(/%2F/g, "/")}?ref=${encodeURIComponent(data.ref)}`, headers);
    if (res.status === 401 || res.status === 403) {
      throw new Error("GitHub denied access to this file. Install/configure the Cortex GitHub App on the repo from /access.");
    }
    if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
    const text = await res.text();
    const truncated = text.length > 80000;
    const content = truncated ? text.slice(0, 80000) : text;

    try {
      await supabaseAdmin.from("gh_file_cache").upsert([{
        id: cacheId,
        owner: data.owner,
        repo: data.repo,
        ref: data.ref,
        path: data.path,
        content,
        truncated,
        fetched_at: new Date().toISOString(),
      }]);
    } catch (e) { console.warn("[cache] gh_file_cache write failed:", (e as Error).message); }

    return { content, truncated };
  });

// ============= Commit & push =============

const CommitInput = z.object({
  owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  branch: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
  files: z.array(z.object({
    path: z.string().min(1).max(500),
    content: z.string().max(1_000_000),
  })).min(1).max(50),
  authorName: z.string().max(100).optional(),
  authorEmail: z.string().email().max(200).optional(),
});

export type CommitResult = {
  commitSha: string;
  branch: string;
  url: string;
};

export const commitFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CommitInput.parse(data))
  .handler(async ({ data }): Promise<CommitResult> => {
    const headers = await ghHeaders(data.owner);
    if (!headers.Authorization) {
      throw new Error("No GitHub App installation found for this owner. Install the Cortex GitHub App with write access from /access.");
    }
    const jsonHeaders = { ...headers, "Content-Type": "application/json" };
    const base = `https://api.github.com/repos/${data.owner}/${data.repo}`;

    // 1. Get current branch ref
    const refRes = await ghFetch(`${base}/git/ref/heads/${encodeURIComponent(data.branch)}`, headers);
    if (refRes.status === 404) throw new Error(`Branch '${data.branch}' not found in ${data.owner}/${data.repo}.`);
    if (refRes.status === 401 || refRes.status === 403) throw new Error("GitHub auth failed. Token needs 'repo' write scope.");
    if (!refRes.ok) throw new Error(`Failed to read branch ref (${refRes.status})`);
    const refJson = (await refRes.json()) as { object: { sha: string } };
    const baseCommitSha = refJson.object.sha;

    // 2. Get base commit -> base tree
    const commitRes = await ghFetch(`${base}/git/commits/${baseCommitSha}`, headers);
    if (!commitRes.ok) throw new Error(`Failed to read base commit (${commitRes.status})`);
    const commitJson = (await commitRes.json()) as { tree: { sha: string } };
    const baseTreeSha = commitJson.tree.sha;

    // 3. Create blobs for each file
    const treeItems: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
    for (const f of data.files) {
      const blobRes = await fetch(`${base}/git/blobs`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
      });
      if (!blobRes.ok) {
        const t = await blobRes.text();
        throw new Error(`Failed to create blob for ${f.path} (${blobRes.status}): ${t.slice(0, 200)}`);
      }
      const { sha } = (await blobRes.json()) as { sha: string };
      treeItems.push({ path: f.path, mode: "100644", type: "blob", sha });
    }

    // 4. Create new tree
    const treeRes = await fetch(`${base}/git/trees`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    if (!treeRes.ok) {
      const t = await treeRes.text();
      throw new Error(`Failed to create tree (${treeRes.status}): ${t.slice(0, 200)}`);
    }
    const newTree = (await treeRes.json()) as { sha: string };

    // 5. Create commit
    const commitBody: Record<string, unknown> = {
      message: data.message,
      tree: newTree.sha,
      parents: [baseCommitSha],
    };
    if (data.authorName && data.authorEmail) {
      commitBody.author = { name: data.authorName, email: data.authorEmail };
    }
    const newCommitRes = await fetch(`${base}/git/commits`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(commitBody),
    });
    if (!newCommitRes.ok) {
      const t = await newCommitRes.text();
      throw new Error(`Failed to create commit (${newCommitRes.status}): ${t.slice(0, 200)}`);
    }
    const newCommit = (await newCommitRes.json()) as { sha: string };

    // 6. Update branch ref
    const updRes = await fetch(`${base}/git/refs/heads/${encodeURIComponent(data.branch)}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    });
    if (!updRes.ok) {
      const t = await updRes.text();
      throw new Error(`Failed to push (${updRes.status}): ${t.slice(0, 200)}`);
    }

    // 7. Invalidate file cache for committed paths
    try {
      const ids = data.files.map((f) => `${data.owner}/${data.repo}@${data.branch}:${f.path}`);
      await supabaseAdmin.from("gh_file_cache").delete().in("id", ids);
    } catch (e) { console.warn("[cache] invalidate after commit failed:", (e as Error).message); }

    return {
      commitSha: newCommit.sha,
      branch: data.branch,
      url: `https://github.com/${data.owner}/${data.repo}/commit/${newCommit.sha}`,
    };
  });