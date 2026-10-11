"""
Jobs endpoints — port of src/lib/server-fns/jobs.functions.ts

POST /jobs/enqueue → enqueueJob
GET  /jobs/{id}    → getJob status
"""
import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lib.auth import AuthUser
from lib.supabase import get_supabase

router = APIRouter(prefix="/jobs", tags=["Jobs"])


# ── helpers ──────────────────────────────────────────────────────────────────

async def _update_job(job_id: str, patch: dict) -> None:
    try:
        get_supabase().table("jobs").update(patch).eq("id", job_id).execute()
    except Exception as e:
        print(f"[jobs] update failed: {e}")


def _is_rate_limit(err: Exception) -> bool:
    msg = str(err).lower()
    return any(k in msg for k in ("rate", "limit", "429", "403"))


async def _run_with_retry(job_id: str, label: str, fn, max_attempts: int = 4):
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            await _update_job(job_id, {"status": "running", "attempts": attempt, "message": f"{label} (attempt {attempt})"})
            return await fn()
        except Exception as e:
            last_err = e
            if attempt >= max_attempts:
                break
            rl = _is_rate_limit(e)
            wait = min(20, 2 * (2 ** (attempt - 1))) if rl else 0.8 * attempt
            await _update_job(job_id, {
                "status": "retrying",
                "message": f"{e}. Retrying in {round(wait)}s…",
            })
            await asyncio.sleep(wait)
    raise last_err or RuntimeError("Job failed")


# ── job runners ───────────────────────────────────────────────────────────────

async def _run_repo_analyze(job_id: str, owner: str, repo: str, ref: str | None, user: dict) -> None:
    try:
        from routers.github import fetch_repo, RepoRequest
        await _update_job(job_id, {"progress": 10, "message": "Fetching repository metadata…"})
        meta = await _run_with_retry(job_id, "Fetch repo",
            lambda: fetch_repo(RepoRequest(owner=owner, repo=repo, ref=ref), user))
        await _update_job(job_id, {
            "status": "done",
            "progress": 100,
            "message": f"Indexed {len(meta.get('tree', []))} entries on {meta.get('defaultBranch')}.",
            "result": {"defaultBranch": meta.get("defaultBranch"), "files": len(meta.get("tree", [])), "lazy": meta.get("lazy")},
        })
    except Exception as e:
        await _update_job(job_id, {"status": "error", "error": str(e), "message": "Failed"})


async def _run_file_explain(
    job_id: str, owner: str, repo: str, ref: str, path: str, language: str | None, user: dict
) -> dict | None:
    try:
        from routers.github import fetch_file, FileRequest
        from routers.ai import explain_file, ExplainRequest
        await _update_job(job_id, {"progress": 20, "message": f"Loading {path}…"})
        file = await _run_with_retry(job_id, "Fetch file",
            lambda: fetch_file(FileRequest(owner=owner, repo=repo, ref=ref, path=path), user))
        await _update_job(job_id, {"progress": 60, "message": "Asking AI to explain…"})
        exp = await _run_with_retry(job_id, "Explain",
            lambda: explain_file(ExplainRequest(path=path, code=file["content"], language=language), user))
        await _update_job(job_id, {
            "status": "done",
            "progress": 100,
            "message": "Done (from cache)" if exp.get("cached") else "Done",
            "result": {"explanation": exp["content"], "cached": exp.get("cached", False)},
        })
        return {"explanation": exp["content"], "cached": exp.get("cached", False)}
    except Exception as e:
        await _update_job(job_id, {"status": "error", "error": str(e), "message": "Failed"})
        raise


async def _run_repo_index(job_id: str, owner: str, repo: str, ref: str | None, user: dict) -> None:
    try:
        from routers.rag import index_repo, IndexRequest
        await _update_job(job_id, {"progress": 5, "message": "Starting repo indexing…"})
        await index_repo(IndexRequest(owner=owner, repo=repo, ref=ref, jobId=job_id), user)
    except Exception as e:
        await _update_job(job_id, {"status": "error", "error": str(e), "message": "Indexing failed"})


# ── /jobs/enqueue ─────────────────────────────────────────────────────────────

class RepoAnalyzeJob(BaseModel):
    kind: Literal["repo_analyze"]
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str | None = Field(default=None, max_length=100)


class FileExplainJob(BaseModel):
    kind: Literal["file_explain"]
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str = Field(min_length=1, max_length=100)
    path: str = Field(min_length=1, max_length=500)
    language: str | None = Field(default=None, max_length=50)


class RepoIndexJob(BaseModel):
    kind: Literal["repo_index"]
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str | None = Field(default=None, max_length=100)


from typing import Union
from pydantic import RootModel

EnqueueRequest = Union[RepoAnalyzeJob, FileExplainJob, RepoIndexJob]


@router.post("/enqueue")
async def enqueue_job(body: EnqueueRequest, user: AuthUser) -> dict:
    """
    Create a job record and run the job synchronously (same pattern as TypeScript version).
    Job progress is written to the jobs table for Supabase Realtime subscriptions.
    """
    supabase = get_supabase()
    user_id = user["user_id"]

    if body.kind == "file_explain":
        target = f"{body.owner}/{body.repo}@{body.ref}:{body.path}"
    else:
        target = f"{body.owner}/{body.repo}@{body.ref or '_default'}"

    # Create job row
    row_res = (
        supabase.table("jobs")
        .insert({"kind": body.kind, "target": target, "status": "queued", "message": "Queued", "user_id": user_id})
        .execute()
    )
    if getattr(row_res, "error", None) or not row_res.data:
        raise HTTPException(status_code=500, detail=str(getattr(row_res, "error", "Failed to create job")))
    job_id = row_res.data[0]["id"]

    # Run job
    if body.kind == "repo_analyze":
        await _run_repo_analyze(job_id, body.owner, body.repo, body.ref, user)
        return {"jobId": job_id, "target": target}
    elif body.kind == "file_explain":
        try:
            result = await _run_file_explain(job_id, body.owner, body.repo, body.ref, body.path, body.language, user)
            return {"jobId": job_id, "target": target, "result": result}
        except Exception as e:
            return {"jobId": job_id, "target": target, "error": str(e)}
    else:  # repo_index
        await _run_repo_index(job_id, body.owner, body.repo, body.ref, user)
        return {"jobId": job_id, "target": target}


# ── /jobs/{id} ────────────────────────────────────────────────────────────────

@router.get("/{job_id}")
async def get_job(job_id: str, _user: AuthUser) -> dict:
    """Fetch a job row by ID."""
    supabase = get_supabase()
    res = supabase.table("jobs").select("*").eq("id", job_id).maybe_single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return res.data
