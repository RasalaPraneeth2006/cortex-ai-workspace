"""Validate sessions with Supabase Auth; supports legacy and asymmetric keys."""
import os
from typing import Annotated
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from lib.supabase import get_supabase

bearer_scheme = HTTPBearer(auto_error=False)

def get_current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]) -> dict:
    if credentials is None:
        raise HTTPException(401, "Missing Authorization header")
    try:
        user = get_supabase().auth.get_user(credentials.credentials).user
    except Exception:
        raise HTTPException(401, "Invalid or expired session")
    if not user:
        raise HTTPException(401, "Invalid session")
    operator = os.environ.get("CORTEX_OPERATOR_ID")
    if not operator or str(user.id) != operator:
        raise HTTPException(403, "API access is restricted to the configured operator")
    return {"user_id": str(user.id)}

AuthUser = Annotated[dict, Depends(get_current_user)]
