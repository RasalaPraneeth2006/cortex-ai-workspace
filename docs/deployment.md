# Local and Render setup

This release supports one trusted operator. Both servers require CORTEX_OPERATOR_ID,
the UUID of that user's Supabase Auth account. The Python API uses a narrowly scoped
GITHUB_TOKEN PAT. GitHub App OAuth in /access is a separate integration; it does not
supply Python credentials. Do not enable public multi-user access without replacing
this restriction with verified per-user GitHub authorization.

## Local

1. Use Node 22.12+ (Node 22 recommended), Python 3.12, and the Supabase CLI.
2. From the repository root, run `npm ci` and copy `.env.example` to `.env`.
   Fill browser VITE_* settings and all server settings. Use APP_ORIGIN=http://localhost:5173.
3. Run `supabase login`, `supabase link --project-ref YOUR_PROJECT_REF`, then
   `supabase db push` from the repository root. Review the target before pushing.
   The new migration protects search and adds editor revision tracking.
4. Create the operator account using Supabase Auth and set its UUID in both env files.
5. In a second terminal: `cd backend`, `python -m venv .venv`, activate the venv,
   run `python -m pip install -r requirements.lock.txt`, copy `.env.example` to `.env`,
   fill the values, then `uvicorn main:app --reload --port 8000`.
6. In the root terminal run `npm run dev`. Visit http://localhost:5173.

The root .env is for TanStack and browser builds; backend/.env is loaded only by Python.
VITE_* variables are public build-time values. Never put secrets in them.
SUPABASE_JWT_SECRET is no longer needed: Python verifies sessions through Supabase Auth.
GitHub App ID/private key variables in backend/.env are unused by the current adapter.

## Render

Use the Blueprint to create two web services: a Node TanStack server and Python API.
The Node build must produce `.output/server/index.mjs`; `npm start` runs this server.
Set VITE_PYTHON_API_URL to the Python HTTPS URL before building the frontend.
Set APP_ORIGIN to the actual frontend HTTPS origin and ALLOWED_ORIGINS on Python to
that same origin (no trailing slash). Set both servers' CORTEX_OPERATOR_ID identically.
Set Supabase Auth Site URL and allowed redirects to the actual app URLs.
For GitHub OAuth, register APP_ORIGIN/api/github/oauth/callback as the callback/setup URL.
Use a separate GitHub App for localhost if necessary. Supply the multiline private key
as a secret. GITHUB_APP_SLUG is optional; it is fetched when omitted.

Run migrations before deploying the new editor. Existing imported files must be
re-imported to obtain a blob SHA. After a successful commit, re-import before editing
and committing again. A changed remote file returns 409; preserve your local changes
and compare them with a fresh import. Only existing UTF-8 regular files up to 80 KB
are supported. Executable modes are preserved; binary files and symlinks are rejected.

## Limits and verification

Jobs currently run within the request: POST /jobs/enqueue and GET /jobs/{id}.
They are not a durable background queue. A restart may leave a running job unfinished.
RAG uses PostgreSQL full-text search, not vector embeddings. Indexing is capped at
200 files, rejects incomplete trees, excludes .env files, and reports file failures.
A partial index may remain after a failed run. Use small repositories for this release.

Before release, verify login, OAuth on both origins, the editor AI action, a commit to
a disposable branch, stale-file rejection, executable permissions, unauthorized-user
rejection, indexing/search, and migration replay on a clean Supabase project.
Health checks report process availability; they do not prove GitHub/AI credentials work.

Pending production work: per-user GitHub authorization, durable jobs with retries and
recovery, resumable atomic indexing, integration
validation against live Supabase/GitHub/Render services. Do not claim production readiness
until these checks are completed.
