"""
AI endpoints — port of src/lib/server-fns/ai.functions.ts

POST /ai/chat      → aiChat
POST /ai/explain   → explainFile (with Supabase explain-cache)
"""
import hashlib
import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lib.auth import AuthUser
from lib.supabase import get_supabase

router = APIRouter(prefix="/ai", tags=["AI"])

AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions"
DEFAULT_MODEL = "google/gemini-2.5-flash"


def _api_key() -> str:
    key = os.environ.get("LOVABLE_API_KEY", "")
    if not key:
        raise HTTPException(status_code=500, detail="LOVABLE_API_KEY not configured")
    return key


async def _call_ai(messages: list[dict], model: str = DEFAULT_MODEL) -> str:
    """Call the AI gateway and return the first choice content."""
    async with httpx.AsyncClient(timeout=90) as client:
        res = await client.post(
            AI_GATEWAY,
            headers={"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages},
        )
    if res.status_code == 429:
        raise HTTPException(status_code=429, detail="Rate limit reached. Please wait and try again.")
    if res.status_code == 402:
        raise HTTPException(status_code=402, detail="AI credits exhausted. Add credits in Settings → Workspace → Usage.")
    if not res.is_success:
        raise HTTPException(status_code=502, detail=f"AI gateway error ({res.status_code}): {res.text[:200]}")
    data = res.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


# ── /ai/chat ─────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1, max_length=20000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)
    system: str | None = Field(default=None, max_length=4000)
    model: str | None = Field(default=None, max_length=100)


@router.post("/chat")
async def ai_chat(body: ChatRequest, _user: AuthUser) -> dict:
    """General AI chat completion. Mirrors aiChat server function."""
    sys_msg = body.system or (
        "You are Cortex, an expert AI developer co-pilot. Explain code clearly and concisely "
        "using Markdown. Use short paragraphs and bullet lists. When asked about a repository "
        "or file, focus on architecture, key functions, and dependencies."
    )
    messages = [{"role": "system", "content": sys_msg}] + [
        m.model_dump() for m in body.messages
    ]
    content = await _call_ai(messages, model=body.model or DEFAULT_MODEL)
    return {"content": content}


# ── /ai/explain ───────────────────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    code: str = Field(min_length=1, max_length=40000)
    language: str | None = Field(default=None, max_length=50)


@router.post("/explain")
async def explain_file(body: ExplainRequest, _user: AuthUser) -> dict:
    """
    Explain a source file using AI, with persistent caching in ai_explain_cache.
    Mirrors explainFile server function.
    """
    # Build cache key
    raw = f"{body.path}\x00{body.language or ''}\x00{body.code}"
    hash_val = hashlib.sha256(raw.encode()).hexdigest()
    cache_id = hash_val[:32]

    # Check cache
    supabase = get_supabase()
    try:
        row = (
            supabase.table("ai_explain_cache")
            .select("explanation")
            .eq("id", cache_id)
            .maybe_single()
            .execute()
        )
        if row.data and row.data.get("explanation"):
            return {"content": row.data["explanation"], "cached": True}
    except Exception as e:
        print(f"[cache] ai_explain_cache read failed: {e}")

    # Build prompt
    prompt = f"""Analyze the file `{body.path}` ({body.language or 'unknown'}).

Return Markdown with EXACTLY these sections in this order:

## Summary
One or two sentences describing what this file does.

## Key functions / exports
Bullet list, each item: `name` — one-line description.

## Logic flow
Short numbered steps describing how the file executes top-to-bottom.

## Patterns & dependencies
Notable patterns, external modules, and internal references.

```{body.language or ''}
{body.code[:30000]}
```"""

    messages = [
        {"role": "system", "content": "You are Cortex, an expert code reader. Be precise and concise. Use Markdown."},
        {"role": "user", "content": prompt},
    ]
    content = await _call_ai(messages)

    # Write to cache
    if content:
        try:
            from datetime import datetime, timezone
            supabase.table("ai_explain_cache").upsert([{
                "id": cache_id,
                "path": body.path,
                "language": body.language,
                "content_hash": hash_val,
                "explanation": content,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }]).execute()
        except Exception as e:
            print(f"[cache] ai_explain_cache write failed: {e}")

    return {"content": content, "cached": False}
