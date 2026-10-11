/**
 * Python Backend API Client
 *
 * Wraps all calls to the FastAPI Python backend running at VITE_PYTHON_API_URL.
 * Automatically injects the current Supabase session token into every request.
 *
 * Usage:
 *   import { pythonApi } from "@/lib/python-api";
 *
 *   const result = await pythonApi.ai.chat({ messages: [...] });
 *   const repo   = await pythonApi.github.fetchRepo({ owner, repo });
 *   const hits   = await pythonApi.rag.search({ owner, repo, ref, query });
 */

import { supabase } from "@/integrations/supabase/client";

// ── Base URL ─────────────────────────────────────────────────────────────────

const BASE_URL = (
  import.meta.env.VITE_PYTHON_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

// ── Core fetch helper ─────────────────────────────────────────────────────────

class PythonApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "PythonApiError";
  }
}

async function getToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new PythonApiError(401, "Not authenticated — please sign in first.");
  }
  return session.access_token;
}

async function apiFetch<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getToken();
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      detail = json.detail ?? JSON.stringify(json);
    } catch {
      detail = await res.text().catch(() => detail);
    }
    throw new PythonApiError(res.status, detail);
  }

  return res.json() as Promise<T>;
}

const get = <T>(path: string) => apiFetch<T>("GET", path);
const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>("POST", path, body);

// ── Types (mirroring Python Pydantic models) ──────────────────────────────────

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface GhTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

export interface RepoMeta {
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
}

export interface RagHit {
  path: string;
  language: string | null;
  chunk_index: number;
  content: string;
  rank: number;
}

export interface JobResult {
  jobId: string;
  target: string;
  result?: unknown;
  error?: string;
}

export interface DashboardStats {
  counts: {
    repos: number;
    docs: number;
    chunks: number;
    workspaceFiles: number;
    aiQueries: number;
  };
  recentJobs: Array<{
    id: string;
    kind: string;
    target: string;
    status: string;
    message: string | null;
    updated_at: string;
    created_at: string;
  }>;
  recentRepos: Array<{
    owner: string;
    repo: string;
    ref: string;
    default_branch: string;
    fetched_at: string;
  }>;
}

// ── AI ────────────────────────────────────────────────────────────────────────

const ai = {
  /** General AI chat completion. */
  chat: (body: {
    messages: Message[];
    system?: string;
    model?: string;
  }): Promise<{ content: string }> => post("/ai/chat", body),

  /** Explain a source file (uses Supabase explain-cache). */
  explain: (body: {
    path: string;
    code: string;
    language?: string;
  }): Promise<{ content: string; cached: boolean }> =>
    post("/ai/explain", body),
};

// ── GitHub ────────────────────────────────────────────────────────────────────

const github = {
  /** Fetch repo metadata + file tree. */
  fetchRepo: (body: {
    owner: string;
    repo: string;
    ref?: string;
    recursive?: boolean;
  }): Promise<RepoMeta> => post("/github/repo", body),

  /** Lazy-load a subtree by SHA. */
  fetchSubtree: (body: {
    owner: string;
    repo: string;
    sha: string;
    basePath?: string;
  }): Promise<{ items: GhTreeItem[]; truncated: boolean }> =>
    post("/github/subtree", body),

  /** Fetch a raw file with caching. */
  fetchFile: (body: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<{ content: string; truncated: boolean }> =>
    post("/github/file", body),

  /** Create and push a Git commit. */
  commitFiles: (body: {
    owner: string;
    repo: string;
    branch: string;
    message: string;
    files: Array<{ path: string; content: string }>;
    authorName?: string;
    authorEmail?: string;
  }): Promise<{ commitSha: string; branch: string; url: string }> =>
    post("/github/commit", body),
};

// ── RAG ───────────────────────────────────────────────────────────────────────

const rag = {
  /** Index a repo into repo_chunks. */
  indexRepo: (body: {
    owner: string;
    repo: string;
    ref?: string;
    jobId?: string;
  }): Promise<{ ref: string; files: number; chunks: number }> =>
    post("/rag/index", body),

  /** Full-text search over repo chunks. */
  search: (body: {
    owner: string;
    repo: string;
    ref: string;
    query: string;
    limit?: number;
  }): Promise<{ hits: RagHit[] }> => post("/rag/search", body),

  /** RAG-grounded AI chat. */
  chat: (body: {
    owner: string;
    repo: string;
    ref: string;
    question: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{
    answer: string;
    sources: Array<{ n: number; path: string; chunk_index: number; rank: number }>;
  }> => post("/rag/chat", body),

  /** Chunk/file index stats for a repo. */
  stats: (body: {
    owner: string;
    repo: string;
    ref?: string;
  }): Promise<{ chunks: number; files: number; lastIndexedAt: string | null }> =>
    post("/rag/stats", body),
};

// ── Stats ─────────────────────────────────────────────────────────────────────

const stats = {
  /** User dashboard stats. */
  dashboard: (): Promise<DashboardStats> => get("/stats/dashboard"),

  /** List AI-generated docs. */
  listDocs: (): Promise<
    Array<{
      id: string;
      path: string;
      language: string | null;
      created_at: string;
      preview: string;
      chars: number;
    }>
  > => get("/stats/docs"),

  /** Fetch full doc content by ID. */
  getDoc: (body: { id: string }): Promise<{
    id: string;
    path: string;
    language: string | null;
    explanation: string;
    created_at: string;
  }> => post("/stats/doc", body),

  /** Language/file distribution insights for a repo. */
  insights: (body: {
    owner: string;
    repo: string;
    ref?: string;
  }): Promise<{
    owner: string;
    repo: string;
    ref: string;
    defaultBranch: string | null;
    fetchedAt: string | null;
    totals: {
      files: number;
      folders: number;
      totalBytes: number;
      indexedChunks: number;
      explanations: number;
    };
    languages: Array<{ ext: string; count: number }>;
    hasCache: boolean;
  }> => post("/stats/insights", body),

  /** Generate a summary or architecture report. */
  generateReport: (body: {
    owner: string;
    repo: string;
    ref?: string;
    kind: "summary" | "architecture";
  }): Promise<{ markdown: string; filename: string }> =>
    post("/stats/report", body),
};

// ── Jobs ──────────────────────────────────────────────────────────────────────

const jobs = {
  /** Enqueue and run a background job. */
  enqueue: (
    body:
      | { kind: "repo_analyze"; owner: string; repo: string; ref?: string }
      | { kind: "file_explain"; owner: string; repo: string; ref: string; path: string; language?: string }
      | { kind: "repo_index"; owner: string; repo: string; ref?: string },
  ): Promise<JobResult> => post("/jobs/enqueue", body),

  /** Get job status by ID. */
  getJob: (jobId: string): Promise<{
    id: string;
    kind: string;
    target: string;
    status: string;
    message: string | null;
    progress: number | null;
    result: unknown;
    error: string | null;
  }> => get(`/jobs/${jobId}`),
};

// ── Health ────────────────────────────────────────────────────────────────────

const health = (): Promise<{ status: string; service: string }> =>
  fetch(`${BASE_URL}/health`).then((r) => r.json());

// ── Exports ───────────────────────────────────────────────────────────────────

export { PythonApiError };

/** Fully-typed client for the CortexAI Python backend. */
export const pythonApi = { ai, github, rag, stats, jobs, health };
