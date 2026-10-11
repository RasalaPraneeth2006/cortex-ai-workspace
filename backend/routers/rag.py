"""
RAG endpoints — port of src/lib/server-fns/rag.functions.ts

POST /rag/index    → indexRepo   (chunk + upsert repo_chunks)
POST /rag/search   → searchRepo  (Postgres FTS via search_repo_chunks RPC)
POST /rag/chat     → ragChat     (RAG-grounded AI chat)
POST /rag/stats    → repoIndexStats
"""
import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lib.auth import AuthUser
from lib.supabase import get_supabase

router = APIRouter(prefix="/rag", tags=["RAG"])

AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions"
DEFAULT_MODEL = "google/gemini-2.5-flash"

TEXT_EXT = {
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "txt", "yml", "yaml",
    "toml", "ini", "env", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp",
    "hpp", "cs", "php", "sh", "bash", "zsh", "css", "scss", "less", "html", "vue", "svelte",
    "sql", "graphql", "gql", "prisma", "dockerfile", "makefile",
}
SKIP_DIR = {
    "node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage",
    ".cache", "out", "target", "vendor", ".venv", "__pycache__",
}
MAX_FILE_BYTES = 120_000
CHUNK_CHARS = 1800
CHUNK_OVERLAP = 200
MAX_FILES_PER_RUN = 200


def _lang_of(path: str) -> str:
    lower = path.lower()
    if lower.endswith("dockerfile") or "/dockerfile" in lower:
        return "dockerfile"
    if lower.endswith("makefile") or "/makefile" in lower:
        return "makefile"
    parts = lower.split(".")
    return parts[-1] if len(parts) > 1 else ""


def _is_indexable(path: str, size: int | None = None) -> bool:
    parts = path.split("/")
    if any(p in SKIP_DIR for p in parts):
        return False
    if size is not None and size > MAX_FILE_BYTES:
        return False
    return _lang_of(path) in TEXT_EXT


def _chunk_text(text: str) -> list[str]:
    chunks = []
    i = 0
    while i < len(text):
        chunks.append(text[i : i + CHUNK_CHARS])
        if i + CHUNK_CHARS >= len(text):
            break
        i += CHUNK_CHARS - CHUNK_OVERLAP
    return chunks or [""]


async def _update_job(job_id: str | None, patch: dict) -> None:
    if not job_id:
        return
    try:
        get_supabase().table("jobs").update(patch).eq("id", job_id).execute()
    except Exception as e:
        print(f"[jobs] update failed: {e}")


# ── /rag/index ────────────────────────────────────────────────────────────────

class IndexRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str | None = Field(default=None, max_length=100)
    jobId: str | None = None


@router.post("/index")
async def index_repo(body: IndexRequest, _user: AuthUser) -> dict:
    """
    Chunk all indexable text files in a repo and upsert into repo_chunks.
    Mirrors indexRepo. Calls the Python github router internally.
    """
    from routers.github import fetch_repo, fetch_file, RepoRequest, FileRequest

    # Fetch repo metadata
    meta = await fetch_repo(RepoRequest(owner=body.owner, repo=body.repo, ref=body.ref), _user)
    ref = meta["defaultBranch"]

    candidates = [
        t for t in meta.get("tree", [])
        if t.get("type") == "blob" and _is_indexable(t.get("path", ""), t.get("size"))
    ][:MAX_FILES_PER_RUN]

    await _update_job(body.jobId, {"progress": 10, "message": f"Indexing {len(candidates)} files…"})

    supabase = get_supabase()
    done = 0
    chunks_written = 0

    for file in candidates:
        try:
            f = await fetch_file(
                FileRequest(owner=body.owner, repo=body.repo, ref=ref, path=file["path"]),
                _user,
            )
            text = (f.get("content") or "").strip()
            if not text:
                done += 1
                continue
            pieces = _chunk_text(text)

            # Remove old chunks for this file
            supabase.table("repo_chunks").delete().eq("owner", body.owner).eq("repo", body.repo).eq("ref", ref).eq("path", file["path"]).execute()

            rows = [
                {
                    "owner": body.owner,
                    "repo": body.repo,
                    "ref": ref,
                    "path": file["path"],
                    "language": _lang_of(file["path"]),
                    "chunk_index": idx,
                    "content": piece,
                    "token_count": max(1, len(piece) // 4),
                }
                for idx, piece in enumerate(pieces)
            ]
            if rows:
                res = supabase.table("repo_chunks").insert(rows).execute()
                if not getattr(res, "error", None):
                    chunks_written += len(rows)
        except Exception:
            pass

        done += 1
        if done % 10 == 0 or done == len(candidates):
            progress = min(95, 10 + round((done / max(1, len(candidates))) * 85))
            await _update_job(body.jobId, {
                "progress": progress,
                "message": f"Indexed {done}/{len(candidates)} files ({chunks_written} chunks)",
            })

    await _update_job(body.jobId, {
        "status": "done",
        "progress": 100,
        "message": f"Indexed {done} files, {chunks_written} chunks on {ref}.",
        "result": {"files": done, "chunks": chunks_written, "ref": ref},
    })

    return {"ref": ref, "files": done, "chunks": chunks_written}


# ── /rag/search ───────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str = Field(min_length=1, max_length=100)
    query: str = Field(min_length=1, max_length=1000)
    limit: int = Field(default=8, ge=1, le=20)


@router.post("/search")
async def search_repo(body: SearchRequest, _user: AuthUser) -> dict:
    """Full-text search over repo_chunks via Postgres RPC. Mirrors searchRepo."""
    supabase = get_supabase()
    res = supabase.rpc("search_repo_chunks", {
        "_owner": body.owner,
        "_repo": body.repo,
        "_ref": body.ref,
        "_query": body.query,
        "_limit": body.limit,
    }).execute()
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=str(res.error))
    return {"hits": res.data or []}


# ── /rag/chat ─────────────────────────────────────────────────────────────────

class HistoryMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class RagChatRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=4000)
    history: list[HistoryMessage] = Field(default=[], max_length=20)


@router.post("/chat")
async def rag_chat(body: RagChatRequest, _user: AuthUser) -> dict:
    """RAG-grounded chat. Mirrors ragChat."""
    api_key = os.environ.get("LOVABLE_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="LOVABLE_API_KEY not configured")

    search_res = await search_repo(
        SearchRequest(owner=body.owner, repo=body.repo, ref=body.ref, query=body.question, limit=8),
        _user,
    )
    hits = search_res.get("hits", [])

    context = "\n\n".join(
        f"[#{i+1}] {h['path']} (chunk {h['chunk_index']})\n```{h.get('language') or ''}\n{h['content'][:1600]}\n```"
        for i, h in enumerate(hits)
    )

    system = (
        "You are Cortex, a repository-aware AI engineer. Answer the user's question using ONLY "
        "the provided code excerpts when possible. Cite sources inline as [#1], [#2] matching "
        "the excerpt numbers. If the excerpts are insufficient, say so and suggest which file(s) "
        "to inspect. Format answers in Markdown."
    )

    if hits:
        user_msg = (
            f"Repository: {body.owner}/{body.repo}@{body.ref}\n\n"
            f"Code excerpts:\n\n{context}\n\n---\nQuestion: {body.question}"
        )
    else:
        user_msg = (
            f"Repository: {body.owner}/{body.repo}@{body.ref}\n\n"
            "No indexed excerpts matched the query. Answer from general knowledge but warn "
            f"that the repo wasn't indexed for this query.\n\nQuestion: {body.question}"
        )

    messages = (
        [{"role": "system", "content": system}]
        + [h.model_dump() for h in body.history]
        + [{"role": "user", "content": user_msg}]
    )

    async with httpx.AsyncClient(timeout=90) as client:
        res = await client.post(
            AI_GATEWAY,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": DEFAULT_MODEL, "messages": messages},
        )
    if res.status_code == 429:
        raise HTTPException(status_code=429, detail="Rate limit reached. Wait and retry.")
    if res.status_code == 402:
        raise HTTPException(status_code=402, detail="AI credits exhausted.")
    if not res.is_success:
        raise HTTPException(status_code=502, detail=f"AI error ({res.status_code}): {res.text[:200]}")

    data = res.json()
    answer = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    sources = [
        {"n": i + 1, "path": h["path"], "chunk_index": h["chunk_index"], "rank": h.get("rank")}
        for i, h in enumerate(hits)
    ]
    return {"answer": answer, "sources": sources}


# ── /rag/stats ────────────────────────────────────────────────────────────────

class StatsRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str | None = Field(default=None, max_length=100)


@router.post("/stats")
async def repo_index_stats(body: StatsRequest, _user: AuthUser) -> dict:
    """Return chunk/file counts for an indexed repo. Mirrors repoIndexStats."""
    supabase = get_supabase()
    q = (
        supabase.table("repo_chunks")
        .select("path, indexed_at", count="exact")
        .eq("owner", body.owner)
        .eq("repo", body.repo)
    )
    if body.ref:
        q = q.eq("ref", body.ref)
    res = q.limit(1000).execute()
    rows = res.data or []
    files = len({r["path"] for r in rows})
    last_indexed_at = max((r.get("indexed_at", "") for r in rows), default=None) or None
    return {"chunks": res.count or 0, "files": files, "lastIndexedAt": last_indexed_at}
