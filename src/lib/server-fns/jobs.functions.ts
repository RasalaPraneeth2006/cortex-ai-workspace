import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchRepo, fetchFile } from "./github.functions";
import { explainFile } from "./ai.functions";
import { indexRepo } from "./rag.functions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Background job runner.
 *
 * The TanStack Worker runtime has no real queue, so each enqueue spawns
 * an in-process async worker (no `await` on completion). Status, progress,
 * and retries are persisted in the `jobs` table — the UI subscribes via
 * Supabase Realtime to render live updates.
 */

type JobKind = "repo_analyze" | "file_explain" | "repo_index";

async function update(id: string, patch: Record<string, unknown>) {
  await supabaseAdmin.from("jobs" as never).update(patch as never).eq("id", id);
}

function isRateLimit(err: unknown): boolean {
  const m = (err as Error)?.message ?? "";
  return /rate.?limit|429|403/i.test(m);
}

async function runWithRetry<T>(
  jobId: string,
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await update(jobId, { status: "running", attempts: attempt, message: `${label} (attempt ${attempt})` });
      return await fn();
    } catch (e) {
      lastErr = e;
      const rl = isRateLimit(e);
      if (attempt >= maxAttempts) break;
      const waitMs = rl ? Math.min(20_000, 2_000 * 2 ** (attempt - 1)) : 800 * attempt;
      await update(jobId, {
        status: "retrying",
        message: `${(e as Error).message}. Retrying in ${Math.round(waitMs / 1000)}s…`,
      });
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Job failed");
}

async function runRepoAnalyze(jobId: string, owner: string, repo: string, ref?: string) {
  try {
    await update(jobId, { progress: 10, message: "Fetching repository metadata…" });
    const meta = await runWithRetry(jobId, "Fetch repo", () =>
      fetchRepo({ data: { owner, repo, ref } }),
    );
    await update(jobId, {
      status: "done",
      progress: 100,
      message: `Indexed ${meta.tree.length} entries on ${meta.defaultBranch}.`,
      result: { defaultBranch: meta.defaultBranch, files: meta.tree.length, lazy: meta.lazy },
    });
  } catch (e) {
    await update(jobId, { status: "error", error: (e as Error).message, message: "Failed" });
  }
}

async function runFileExplain(
  jobId: string,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  language?: string,
): Promise<{ explanation: string; cached: boolean } | null> {
  try {
    await update(jobId, { progress: 20, message: `Loading ${path}…` });
    const file = await runWithRetry(jobId, "Fetch file", () =>
      fetchFile({ data: { owner, repo, ref, path } }),
    );
    await update(jobId, { progress: 60, message: "Asking AI to explain…" });
    const exp = await runWithRetry(jobId, "Explain", () =>
      explainFile({ data: { path, code: file.content, language } }),
    );
    await update(jobId, {
      status: "done",
      progress: 100,
      message: exp.cached ? "Done (from cache)" : "Done",
      result: { explanation: exp.content, cached: exp.cached },
    });
    return { explanation: exp.content, cached: exp.cached };
  } catch (e) {
    await update(jobId, { status: "error", error: (e as Error).message, message: "Failed" });
    throw e;
  }
}

async function runRepoIndex(jobId: string, owner: string, repo: string, ref?: string) {
  try {
    await update(jobId, { progress: 5, message: "Starting repo indexing…" });
    await indexRepo({ data: { owner, repo, ref, jobId } });
  } catch (e) {
    await update(jobId, { status: "error", error: (e as Error).message, message: "Indexing failed" });
  }
}

const EnqueueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("repo_analyze"),
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    ref: z.string().max(100).optional(),
  }),
  z.object({
    kind: z.literal("file_explain"),
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    ref: z.string().min(1).max(100),
    path: z.string().min(1).max(500),
    language: z.string().max(50).optional(),
  }),
  z.object({
    kind: z.literal("repo_index"),
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    ref: z.string().max(100).optional(),
  }),
]);

export const enqueueJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EnqueueSchema.parse(d))
  .handler(async ({ data, context }) => {
    const target =
      data.kind === "file_explain"
        ? `${data.owner}/${data.repo}@${data.ref}:${data.path}`
        : `${data.owner}/${data.repo}@${data.ref ?? "_default"}`;

    const { data: row, error } = await supabaseAdmin
      .from("jobs" as never)
      .insert({ kind: data.kind as JobKind, target, status: "queued", message: "Queued", user_id: context.userId } as never)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to create job");
    const jobId = (row as { id: string }).id;

    // Workers have no persistent background tasks — fire-and-forget gets killed
    // when the response is sent. Await the work so it actually runs. UI still
    // gets live progress via Supabase Realtime on the `jobs` row.
    if (data.kind === "repo_analyze") {
      await runRepoAnalyze(jobId, data.owner, data.repo, data.ref);
      return { jobId, target };
    } else if (data.kind === "file_explain") {
      try {
        const result = await runFileExplain(jobId, data.owner, data.repo, data.ref, data.path, data.language);
        return { jobId, target, result };
      } catch (e) {
        return { jobId, target, error: (e as Error).message };
      }
    } else {
      await runRepoIndex(jobId, data.owner, data.repo, data.ref);
      return { jobId, target };
    }
  });