"""
Stats endpoints — port of src/lib/server-fns/stats.functions.ts

GET  /stats/dashboard   → getDashboardStats
GET  /stats/docs        → listGeneratedDocs
POST /stats/doc         → getDocContent
POST /stats/insights    → getRepoInsights
POST /stats/report      → generateRepoReport
"""
import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lib.auth import AuthUser
from lib.supabase import get_supabase

router = APIRouter(prefix="/stats", tags=["Stats"])

AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions"


# ── /stats/dashboard ──────────────────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard_stats(user: AuthUser) -> dict:
    """Return aggregated dashboard stats for the current user. Mirrors getDashboardStats."""
    user_id = user["user_id"]
    supabase = get_supabase()

    repos = supabase.table("gh_repo_cache").select("id", count="exact", head=True).execute()
    docs = supabase.table("ai_explain_cache").select("id", count="exact", head=True).execute()
    chunks = supabase.table("repo_chunks").select("id", count="exact", head=True).execute()
    workspace_files = (
        supabase.table("workspace_files")
        .select("id", count="exact", head=True)
        .eq("created_by", user_id)
        .execute()
    )
    jobs_all = (
        supabase.table("jobs")
        .select("id", count="exact", head=True)
        .eq("user_id", user_id)
        .execute()
    )
    jobs_recent = (
        supabase.table("jobs")
        .select("id, kind, target, status, message, updated_at, created_at")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .limit(8)
        .execute()
    )
    repos_recent = (
        supabase.table("gh_repo_cache")
        .select("owner, repo, ref, default_branch, fetched_at")
        .order("fetched_at", desc=True)
        .limit(6)
        .execute()
    )

    return {
        "counts": {
            "repos": repos.count or 0,
            "docs": docs.count or 0,
            "chunks": chunks.count or 0,
            "workspaceFiles": workspace_files.count or 0,
            "aiQueries": jobs_all.count or 0,
        },
        "recentJobs": jobs_recent.data or [],
        "recentRepos": repos_recent.data or [],
    }


# ── /stats/docs ───────────────────────────────────────────────────────────────

@router.get("/docs")
async def list_generated_docs(_user: AuthUser) -> list:
    """List generated AI explanations. Mirrors listGeneratedDocs."""
    supabase = get_supabase()
    res = (
        supabase.table("ai_explain_cache")
        .select("id, path, language, created_at, explanation")
        .order("created_at", desc=True)
        .limit(60)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=str(res.error))
    return [
        {
            "id": d["id"],
            "path": d["path"],
            "language": d.get("language"),
            "created_at": d.get("created_at"),
            "preview": (d.get("explanation") or "")[:220],
            "chars": len(d.get("explanation") or ""),
        }
        for d in (res.data or [])
    ]


# ── /stats/doc ────────────────────────────────────────────────────────────────

class DocRequest(BaseModel):
    id: str = Field(min_length=1, max_length=200)


@router.post("/doc")
async def get_doc_content(body: DocRequest, _user: AuthUser) -> dict:
    """Fetch full explanation doc by ID. Mirrors getDocContent."""
    supabase = get_supabase()
    res = (
        supabase.table("ai_explain_cache")
        .select("id, path, language, explanation, created_at")
        .eq("id", body.id)
        .maybe_single()
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=str(res.error))
    if not res.data:
        raise HTTPException(status_code=404, detail="Doc not found")
    return res.data


# ── /stats/insights ───────────────────────────────────────────────────────────

class InsightsRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str | None = Field(default=None, max_length=100)


@router.post("/insights")
async def get_repo_insights(body: InsightsRequest, _user: AuthUser) -> dict:
    """Return language distribution, file counts, and index stats. Mirrors getRepoInsights."""
    supabase = get_supabase()

    ref = body.ref
    if not ref:
        latest = (
            supabase.table("gh_repo_cache")
            .select("ref, fetched_at")
            .eq("owner", body.owner)
            .eq("repo", body.repo)
            .order("fetched_at", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        ref = (latest.data or {}).get("ref", "main")

    repo_row = (
        supabase.table("gh_repo_cache")
        .select("data, default_branch, fetched_at")
        .eq("owner", body.owner)
        .eq("repo", body.repo)
        .eq("ref", ref)
        .maybe_single()
        .execute()
    )

    tree = ((repo_row.data or {}).get("data") or {}).get("tree", [])
    files = [n for n in tree if n.get("type") == "blob"]

    lang_map: dict[str, int] = {}
    for f in files:
        ext = (f["path"].split(".")[-1].lower()) if "." in f["path"] else "other"
        lang_map[ext] = lang_map.get(ext, 0) + 1
    languages = sorted(lang_map.items(), key=lambda x: -x[1])[:8]

    chunks_res = (
        supabase.table("repo_chunks")
        .select("id", count="exact", head=True)
        .eq("owner", body.owner)
        .eq("repo", body.repo)
        .eq("ref", ref)
        .execute()
    )
    cached_res = (
        supabase.table("ai_explain_cache")
        .select("id", count="exact", head=True)
        .ilike("path", f"{body.owner}/{body.repo}%")
        .execute()
    )

    return {
        "owner": body.owner,
        "repo": body.repo,
        "ref": ref,
        "defaultBranch": (repo_row.data or {}).get("default_branch"),
        "fetchedAt": (repo_row.data or {}).get("fetched_at"),
        "totals": {
            "files": len(files),
            "folders": len([n for n in tree if n.get("type") == "tree"]),
            "totalBytes": sum(f.get("size", 0) for f in files),
            "indexedChunks": chunks_res.count or 0,
            "explanations": cached_res.count or 0,
        },
        "languages": [{"ext": ext, "count": count} for ext, count in languages],
        "hasCache": bool(repo_row.data),
    }


# ── /stats/report ─────────────────────────────────────────────────────────────

class ReportRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str | None = Field(default=None, max_length=100)
    kind: str = Field(pattern="^(summary|architecture)$")


@router.post("/report")
async def generate_repo_report(body: ReportRequest, _user: AuthUser) -> dict:
    """Generate an AI-written summary or architecture report. Mirrors generateRepoReport."""
    api_key = os.environ.get("LOVABLE_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="LOVABLE_API_KEY not configured")
    supabase = get_supabase()

    ref = body.ref
    if not ref:
        latest = (
            supabase.table("gh_repo_cache")
            .select("ref")
            .eq("owner", body.owner)
            .eq("repo", body.repo)
            .order("fetched_at", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        ref = (latest.data or {}).get("ref", "main")

    repo_row = (
        supabase.table("gh_repo_cache")
        .select("data, default_branch")
        .eq("owner", body.owner)
        .eq("repo", body.repo)
        .eq("ref", ref)
        .maybe_single()
        .execute()
    )
    if not repo_row.data:
        raise HTTPException(status_code=404, detail="Repository not analyzed yet. Analyze it on the Repository page first.")

    tree = ((repo_row.data.get("data") or {}).get("tree") or [])
    files = [n for n in tree if n.get("type") == "blob"]
    top_paths = "\n".join(f["path"] for f in files[:60])
    lang_map: dict[str, int] = {}
    for f in files:
        ext = (f["path"].split(".")[-1].lower()) if "." in f["path"] else "other"
        lang_map[ext] = lang_map.get(ext, 0) + 1
    langs = ", ".join(f"{e}={c}" for e, c in sorted(lang_map.items(), key=lambda x: -x[1])[:10])

    if body.kind == "summary":
        prompt = (
            f'Write a concise Markdown "Repository summary report" for {body.owner}/{body.repo}@{ref}. '
            "Cover: purpose, tech stack, main modules, key entry points, and 3 recommendations. Total ~450 words."
        )
    else:
        prompt = (
            f'Write a Markdown "Architecture overview" for {body.owner}/{body.repo}@{ref}. '
            "Cover: high-level components, data flow, layering, external dependencies, and possible ASCII diagram. ~600 words."
        )

    user_msg = f"{prompt}\n\nFile listing (partial):\n{top_paths}\n\nLanguage distribution: {langs}\nTotal files: {len(files)}"

    async with httpx.AsyncClient(timeout=90) as client:
        res = await client.post(
            AI_GATEWAY,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "google/gemini-2.5-flash",
                "messages": [
                    {"role": "system", "content": "You are Cortex, an expert software architect. Output only Markdown."},
                    {"role": "user", "content": user_msg},
                ],
            },
        )
    if res.status_code == 429:
        raise HTTPException(status_code=429, detail="Rate limit reached. Please wait and try again.")
    if res.status_code == 402:
        raise HTTPException(status_code=402, detail="AI credits exhausted.")
    if not res.is_success:
        raise HTTPException(status_code=502, detail=f"AI gateway error ({res.status_code}): {res.text[:200]}")

    md = res.json().get("choices", [{}])[0].get("message", {}).get("content", "# Report\n\n(no content)")
    return {"markdown": md, "filename": f"{body.owner}-{body.repo}-{ref}-{body.kind}.md"}
