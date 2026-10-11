"""
GitHub endpoints — port of src/lib/server-fns/github.functions.ts

POST /github/repo        → fetchRepo    (with gh_repo_cache)
POST /github/subtree     → fetchSubtree
POST /github/file        → fetchFile    (with gh_file_cache)
POST /github/commit      → commitFiles
"""
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lib.auth import AuthUser
from lib.github_client import gh_fetch, gh_headers, gh_patch, gh_post
from lib.supabase import get_supabase

router = APIRouter(prefix="/github", tags=["GitHub"])

REPO_TTL_S = 6 * 3600        # 6 hours
FILE_TTL_S = 24 * 3600       # 24 hours
LARGE_REPO_THRESHOLD = 4000  # files

_SLUG_RE = re.compile(r"^[a-zA-Z0-9._-]+$")


def _validate_slug(v: str, field: str) -> str:
    if not _SLUG_RE.match(v):
        raise ValueError(f"{field} contains invalid characters")
    return v


# ── /github/repo ─────────────────────────────────────────────────────────────

class RepoRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str | None = Field(default=None, max_length=100)
    recursive: bool | None = None


@router.post("/repo")
async def fetch_repo(body: RepoRequest, _user: AuthUser) -> dict:
    """Fetch repository metadata and file tree. Mirrors fetchRepo."""
    _validate_slug(body.owner, "owner")
    _validate_slug(body.repo, "repo")

    mode = "lazy" if body.recursive is False else "rec"
    cache_id = f"{body.owner}/{body.repo}@{body.ref or '_default'}#{mode}"
    supabase = get_supabase()

    # Check cache
    try:
        row = (
            supabase.table("gh_repo_cache")
            .select("data, fetched_at")
            .eq("id", cache_id)
            .maybe_single()
            .execute()
        )
        if row.data:
            fetched = datetime.fromisoformat(row.data["fetched_at"].replace("Z", "+00:00"))
            if (time.time() - fetched.timestamp()) < REPO_TTL_S:
                return row.data["data"]
    except Exception as e:
        print(f"[cache] gh_repo_cache read failed: {e}")

    headers = await gh_headers(body.owner)

    async with httpx.AsyncClient(timeout=30) as client:
        repo_res = await gh_fetch(
            f"https://api.github.com/repos/{body.owner}/{body.repo}", headers, client
        )
        if repo_res.status_code == 404:
            raise HTTPException(status_code=404, detail="Repository not found, or the GitHub App is not installed on this owner.")
        if repo_res.status_code in (401, 403):
            raise HTTPException(status_code=403, detail="GitHub denied access. Install the Cortex GitHub App from /access.")
        if not repo_res.is_success:
            raise HTTPException(status_code=502, detail=f"GitHub error {repo_res.status_code}")
        repo_json = repo_res.json()

        branch = body.ref or repo_json["default_branch"]

        # Branches
        branches = [repo_json["default_branch"]]
        try:
            br_res = await gh_fetch(
                f"https://api.github.com/repos/{body.owner}/{body.repo}/branches?per_page=100",
                headers, client,
            )
            if br_res.is_success:
                branches = list({repo_json["default_branch"]} | {b["name"] for b in br_res.json()})
        except Exception:
            pass

        # Tree
        lazy = body.recursive is False
        tree_json = {"tree": [], "truncated": False}

        if not lazy:
            tree_res = await gh_fetch(
                f"https://api.github.com/repos/{body.owner}/{body.repo}/git/trees/{branch}?recursive=1",
                headers, client,
            )
            if not tree_res.is_success:
                raise HTTPException(status_code=502, detail=f"Failed to load tree ({tree_res.status_code})")
            tree_json = tree_res.json()
            if tree_json.get("truncated") or len(tree_json.get("tree", [])) > LARGE_REPO_THRESHOLD:
                lazy = True

        if lazy:
            root_res = await gh_fetch(
                f"https://api.github.com/repos/{body.owner}/{body.repo}/git/trees/{branch}",
                headers, client,
            )
            if not root_res.is_success:
                raise HTTPException(status_code=502, detail=f"Failed to load root tree ({root_res.status_code})")
            tree_json = root_res.json()

    meta = {
        "owner": body.owner,
        "repo": body.repo,
        "defaultBranch": branch,
        "branches": branches,
        "description": repo_json.get("description"),
        "stars": repo_json.get("stargazers_count", 0),
        "forks": repo_json.get("forks_count", 0),
        "language": repo_json.get("language"),
        "topics": repo_json.get("topics", []),
        "tree": tree_json.get("tree", []),
        "truncated": tree_json.get("truncated", False),
        "lazy": lazy,
    }

    # Write cache
    try:
        supabase.table("gh_repo_cache").upsert([{
            "id": cache_id,
            "owner": body.owner,
            "repo": body.repo,
            "ref": branch,
            "default_branch": repo_json["default_branch"],
            "data": meta,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }]).execute()
    except Exception as e:
        print(f"[cache] gh_repo_cache write failed: {e}")

    return meta


# ── /github/subtree ──────────────────────────────────────────────────────────

class SubtreeRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    sha: str = Field(min_length=1, max_length=100)
    basePath: str = Field(default="", max_length=500)


@router.post("/subtree")
async def fetch_subtree(body: SubtreeRequest, _user: AuthUser) -> dict:
    """Lazy-load a subtree by SHA. Mirrors fetchSubtree."""
    headers = await gh_headers(body.owner)
    async with httpx.AsyncClient(timeout=20) as client:
        res = await gh_fetch(
            f"https://api.github.com/repos/{body.owner}/{body.repo}/git/trees/{body.sha}",
            headers, client,
        )
    if not res.is_success:
        raise HTTPException(status_code=502, detail=f"Failed to load subtree ({res.status_code})")
    data = res.json()
    items = [
        {**item, "path": f"{body.basePath}/{item['path']}" if body.basePath else item["path"]}
        for item in data.get("tree", [])
    ]
    return {"items": items, "truncated": data.get("truncated", False)}


# ── /github/file ─────────────────────────────────────────────────────────────

class FileRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    ref: str = Field(min_length=1, max_length=100)
    path: str = Field(min_length=1, max_length=500)


@router.post("/file")
async def fetch_file(body: FileRequest, _user: AuthUser) -> dict:
    """Fetch a file's raw content with caching. Mirrors fetchFile."""
    _validate_slug(body.owner, "owner")
    _validate_slug(body.repo, "repo")

    cache_id = f"{body.owner}/{body.repo}@{body.ref}:{body.path}"
    supabase = get_supabase()

    try:
        row = (
            supabase.table("gh_file_cache")
            .select("content, truncated, fetched_at")
            .eq("id", cache_id)
            .maybe_single()
            .execute()
        )
        if row.data:
            fetched = datetime.fromisoformat(row.data["fetched_at"].replace("Z", "+00:00"))
            if (time.time() - fetched.timestamp()) < FILE_TTL_S:
                return {"content": row.data["content"], "truncated": row.data["truncated"]}
    except Exception as e:
        print(f"[cache] gh_file_cache read failed: {e}")

    headers = await gh_headers(body.owner, raw=True)
    safe_path = quote(body.path, safe="/")
    safe_ref = quote(body.ref)

    async with httpx.AsyncClient(timeout=30) as client:
        res = await gh_fetch(
            f"https://api.github.com/repos/{body.owner}/{body.repo}/contents/{safe_path}?ref={safe_ref}",
            headers, client,
        )
    if res.status_code in (401, 403):
        raise HTTPException(status_code=403, detail="GitHub denied access to this file. Install/configure the Cortex GitHub App from /access.")
    if not res.is_success:
        raise HTTPException(status_code=502, detail=f"Failed to load file ({res.status_code})")

    text = res.text
    truncated = len(text) > 80000
    content = text[:80000] if truncated else text

    try:
        supabase.table("gh_file_cache").upsert([{
            "id": cache_id,
            "owner": body.owner,
            "repo": body.repo,
            "ref": body.ref,
            "path": body.path,
            "content": content,
            "truncated": truncated,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }]).execute()
    except Exception as e:
        print(f"[cache] gh_file_cache write failed: {e}")

    return {"content": content, "truncated": truncated}


# ── /github/commit ────────────────────────────────────────────────────────────

class CommitFile(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = Field(max_length=1_000_000)


class CommitRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    branch: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=2000)
    files: list[CommitFile] = Field(min_length=1, max_length=50)
    authorName: str | None = Field(default=None, max_length=100)
    authorEmail: str | None = Field(default=None, max_length=200)


@router.post("/commit")
async def commit_files(body: CommitRequest, _user: AuthUser) -> dict:
    """
    Create a Git commit and push to a branch.
    Mirrors commitFiles — implements the full low-level Git Data API flow.
    """
    _validate_slug(body.owner, "owner")
    _validate_slug(body.repo, "repo")

    headers = await gh_headers(body.owner)
    if "Authorization" not in headers:
        raise HTTPException(
            status_code=403,
            detail="No GitHub App installation found for this owner. Install the Cortex GitHub App with write access from /access.",
        )

    json_headers = {**headers, "Content-Type": "application/json"}
    base = f"https://api.github.com/repos/{body.owner}/{body.repo}"
    safe_branch = quote(body.branch, safe="")

    async with httpx.AsyncClient(timeout=60) as client:
        # 1. Get current branch ref
        ref_res = await gh_fetch(f"{base}/git/ref/heads/{safe_branch}", headers, client)
        if ref_res.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Branch '{body.branch}' not found in {body.owner}/{body.repo}.")
        if ref_res.status_code in (401, 403):
            raise HTTPException(status_code=403, detail="GitHub auth failed. Token needs 'repo' write scope.")
        if not ref_res.is_success:
            raise HTTPException(status_code=502, detail=f"Failed to read branch ref ({ref_res.status_code})")
        base_commit_sha = ref_res.json()["object"]["sha"]

        # 2. Get base commit → base tree
        commit_res = await gh_fetch(f"{base}/git/commits/{base_commit_sha}", headers, client)
        if not commit_res.is_success:
            raise HTTPException(status_code=502, detail=f"Failed to read base commit ({commit_res.status_code})")
        base_tree_sha = commit_res.json()["tree"]["sha"]

        # 3. Create blobs
        tree_items = []
        for f in body.files:
            blob_res = await gh_post(f"{base}/git/blobs", json_headers, {"content": f.content, "encoding": "utf-8"}, client)
            if not blob_res.is_success:
                raise HTTPException(status_code=502, detail=f"Failed to create blob for {f.path} ({blob_res.status_code}): {blob_res.text[:200]}")
            tree_items.append({"path": f.path, "mode": "100644", "type": "blob", "sha": blob_res.json()["sha"]})

        # 4. Create new tree
        tree_res = await gh_post(f"{base}/git/trees", json_headers, {"base_tree": base_tree_sha, "tree": tree_items}, client)
        if not tree_res.is_success:
            raise HTTPException(status_code=502, detail=f"Failed to create tree ({tree_res.status_code}): {tree_res.text[:200]}")
        new_tree_sha = tree_res.json()["sha"]

        # 5. Create commit
        commit_body: dict = {"message": body.message, "tree": new_tree_sha, "parents": [base_commit_sha]}
        if body.authorName and body.authorEmail:
            commit_body["author"] = {"name": body.authorName, "email": body.authorEmail}
        new_commit_res = await gh_post(f"{base}/git/commits", json_headers, commit_body, client)
        if not new_commit_res.is_success:
            raise HTTPException(status_code=502, detail=f"Failed to create commit ({new_commit_res.status_code}): {new_commit_res.text[:200]}")
        new_commit_sha = new_commit_res.json()["sha"]

        # 6. Update branch ref
        upd_res = await gh_patch(
            f"{base}/git/refs/heads/{safe_branch}", json_headers,
            {"sha": new_commit_sha, "force": False}, client,
        )
        if not upd_res.is_success:
            raise HTTPException(status_code=502, detail=f"Failed to push ({upd_res.status_code}): {upd_res.text[:200]}")

    # 7. Invalidate file cache
    try:
        ids = [f"{body.owner}/{body.repo}@{body.branch}:{f.path}" for f in body.files]
        get_supabase().table("gh_file_cache").delete().in_("id", ids).execute()
    except Exception as e:
        print(f"[cache] invalidate after commit failed: {e}")

    return {
        "commitSha": new_commit_sha,
        "branch": body.branch,
        "url": f"https://github.com/{body.owner}/{body.repo}/commit/{new_commit_sha}",
    }
