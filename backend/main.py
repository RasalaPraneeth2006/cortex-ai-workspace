"""
CortexAI Python Backend — FastAPI entry point.

Run locally:
    cd backend
    uvicorn main:app --reload --port 8000

All routes require a valid Supabase JWT in the Authorization header:
    Authorization: Bearer <supabase-access-token>

Auto-generated API docs available at http://localhost:8000/docs
"""
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env from the backend directory
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from routers import ai, github, jobs, rag, stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[startup] CortexAI Python backend starting...")
    yield
    print("[shutdown] CortexAI Python backend shutting down.")


app = FastAPI(
    title="CortexAI Backend",
    description=(
        "Python FastAPI backend for CortexAI — mirrors the TanStack Start server functions. "
        "Provides AI chat, GitHub integration, RAG indexing/search, and job management."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
_origins_raw = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
allowed_origins = [o.strip() for o in _origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(ai.router)
app.include_router(github.router)
app.include_router(rag.router)
app.include_router(stats.router)
app.include_router(jobs.router)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["Meta"])
async def health() -> dict:
    """Returns 200 OK when the server is running."""
    return {"status": "ok", "service": "cortexai-backend"}


@app.get("/", tags=["Meta"])
async def root() -> dict:
    """Root endpoint — redirects users to /docs."""
    return {
        "message": "CortexAI Python Backend is running.",
        "docs": "/docs",
        "health": "/health",
    }
