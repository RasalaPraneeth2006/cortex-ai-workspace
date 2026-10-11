"""
GitHub API client helpers — rate-limit-aware fetch with retries.
Mirrors the ghFetch / ghHeaders pattern from github.functions.ts.
"""
import asyncio
import os
from typing import Any

import httpx

GITHUB_API = "https://api.github.com"
USER_AGENT = "Cortex-Dev-Platform"
GH_API_VERSION = "2022-11-28"


def _base_headers(raw: bool = False) -> dict[str, str]:
    return {
        "Accept": "application/vnd.github.raw" if raw else "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": GH_API_VERSION,
    }


async def gh_headers(owner: str, raw: bool = False) -> dict[str, str]:
    """
    Return GitHub request headers.
    Attempts to get a GitHub App installation token for the owner;
    falls back to unauthenticated if none is available.
    """
    headers = _base_headers(raw)
    # Optional: Add GitHub App token resolution here when GITHUB_APP_ID is configured.
    # For now we fall back to a plain token if set.
    token = os.environ.get("GITHUB_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def gh_fetch(
    url: str,
    headers: dict[str, str],
    client: httpx.AsyncClient,
    attempts: int = 3,
) -> httpx.Response:
    """Fetch with retry on rate-limits and transient errors (mirrors ghFetch in TS)."""
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            res = await client.get(url, headers=headers)
            # Transient errors — back off and retry
            if res.status_code in (429, 502, 503, 504):
                retry_after = int(res.headers.get("retry-after", 0))
                wait = retry_after if retry_after > 0 else min(8, 0.8 * (2**i))
                await asyncio.sleep(wait)
                continue
            # Primary rate-limit signal (403 + x-ratelimit-remaining: 0)
            if res.status_code == 403 and res.headers.get("x-ratelimit-remaining") == "0":
                reset_ts = int(res.headers.get("x-ratelimit-reset", 0))
                import time
                wait = max(0.0, min(15.0, reset_ts - time.time()))
                if wait > 0 and i < attempts - 1:
                    await asyncio.sleep(wait)
                    continue
            return res
        except httpx.RequestError as e:
            last_err = e
            await asyncio.sleep(0.6 * (2**i))
    raise last_err or RuntimeError("GitHub fetch failed after retries")


async def gh_post(
    url: str,
    headers: dict[str, str],
    body: Any,
    client: httpx.AsyncClient,
) -> httpx.Response:
    """POST helper for the GitHub Git Data API."""
    return await client.post(url, headers=headers, json=body)


async def gh_patch(
    url: str,
    headers: dict[str, str],
    body: Any,
    client: httpx.AsyncClient,
) -> httpx.Response:
    return await client.patch(url, headers=headers, json=body)
