## Goal

Let users connect private repos by (1) signing in with GitHub via the App's User OAuth and (2) installing the App on the orgs/repos they want Cortex to access. All GitHub API calls switch from a global `GITHUB_TOKEN` PAT to **installation tokens** (org/repo scoped, auto-refreshing). Remove the PAT UI entirely.

## Schema changes (one migration)

New tables (replace `user_github_tokens` usage; keep table for now but stop writing to it):

- `github_user_identities` — one row per Cortex user
  - `user_id` (PK, FK auth.users), `gh_user_id` bigint, `gh_login` text, `oauth_access_token_enc` text, `oauth_refresh_token_enc` text, `oauth_expires_at` timestamptz, `created_at`, `updated_at`
- `github_app_installations` — one row per App installation the user owns/sees
  - `id` bigint PK (GitHub installation id), `account_login` text, `account_type` text ('User'|'Organization'), `account_id` bigint, `target_type` text, `repository_selection` text ('all'|'selected'), `suspended_at` timestamptz null, `created_at`, `updated_at`
- `github_installation_users` — which Cortex users have OAuth'd and can use which installation
  - `installation_id` bigint, `user_id` uuid, PK(installation_id, user_id)

RLS: each user can read their own identity + installations they're linked to via `github_installation_users`. Service role full access.

## Server-only modules

- `src/integrations/github/app-jwt.server.ts` — sign JWT from `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` (RS256, 10-min exp) using node `crypto.createSign`.
- `src/integrations/github/installation-token.server.ts`
  - `mintInstallationToken(installationId)` — POST `/app/installations/:id/access_tokens`, cache in-memory (Map) with 50-min TTL (tokens last 1h).
  - `getInstallationTokenForRepo(owner, repo, userId)` — find installation that covers `owner` & is linked to `userId`, then mint.
- `src/integrations/github/oauth.server.ts` — `exchangeCode`, `refreshUserToken`, both using client_id/secret.

## Routes (server)

- `GET /api/github/oauth/callback` — handles both:
  - User OAuth callback: `?code&state` → exchange → upsert `github_user_identities` (encrypt tokens with existing `token-cipher.server.ts`) → redirect to `/access?connected=1`.
  - Installation callback: `?installation_id&setup_action&state` → fetch installation metadata via App JWT → upsert `github_app_installations` + link to user via `github_installation_users` → redirect.
  - `state` is a signed cookie containing the Cortex user id + nonce.

## Server functions (replace PAT path)

`src/lib/server-fns/github-app.functions.ts`:
- `startOAuth()` — returns GitHub authorize URL (`https://github.com/login/oauth/authorize?client_id=...&state=...&redirect_uri=...`), sets state cookie.
- `getInstallUrl()` — returns `https://github.com/apps/<app-slug>/installations/new?state=...`. App slug derived from a new optional secret `GITHUB_APP_SLUG` or fetched from `/app` once and cached.
- `listMyInstallations()` — rows from `github_app_installations` joined via `github_installation_users` for current user.
- `listInstallationRepos(installationId)` — `GET /installation/repositories` with installation token.
- `disconnectGitHub()` — clear identity + installation links for user.

Refactor `src/lib/server-fns/github.functions.ts`:
- Replace `ghHeaders()` `process.env.GITHUB_TOKEN` lookup with `getInstallationTokenForRepo(owner, repo, userId)`. Every `fetchRepo`/`fetchFile`/`fetchSubtree`/`commitFiles` becomes auth-aware: take `userId` from `requireSupabaseAuth` middleware, resolve installation, use that token.
- Public repos: if no installation matches, fall back to unauthenticated request (already works for public).
- Remove all references to `GITHUB_TOKEN`.

Refactor `src/lib/server-fns/access.functions.ts`:
- Replace "PAT verify" with "installation verify": check whether user has an installation covering `owner/repo` and read perms via `/repos/{owner}/{repo}` with installation token; map repo permission (`admin/maintain/push/triage/pull`) to existing `repo_role`.
- Drop save/clear PAT server fns.

## UI changes — `src/routes/access.tsx`

Remove the PAT input + "Save token" / "Clear token" entirely. Replace with:

1. **Connect GitHub** button → calls `startOAuth()` → `window.location = url`.
2. After OAuth: show GitHub username + "Disconnect".
3. **Installations** list (from `listMyInstallations`):
   - Each row: account avatar/login, repo selection mode, "Manage on GitHub" link, "Configure / add repos" button.
4. **Install App** button → opens `getInstallUrl()` in same tab.
5. **Verify repo access** input keeps same UX but now powered by installation check, with clear messages: "No installation covers this owner — click Install", "Installation found but repo not selected — Configure on GitHub", "OK — role: …".

Also remove PAT references from `repository.tsx` / `repo-chat.tsx` empty states — replace with "Connect GitHub" CTA when unauthenticated to GH.

## Secrets

Already saved: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`. No new secrets required (App slug fetched at runtime).

## Out of scope (deferred)

- Webhooks (App was created without webhook URL per setup) — installation rows are kept in sync lazily on each `listMyInstallations` call by re-querying `/user/installations` with the user's OAuth token.
- Refresh-token rotation edge cases (user tokens expire in 8h) — handled on demand: if `oauth_expires_at < now()+60s`, refresh before use.
- Existing `user_github_tokens` table — stop writing/reading; leave for a later cleanup migration.

## Order of execution

1. Migration (new tables + RLS + grants).
2. Server-only crypto/JWT/oauth helpers.
3. OAuth callback route.
4. New `github-app.functions.ts` + refactor of `github.functions.ts` + `access.functions.ts`.
5. Rewrite `access.tsx` UI; update empty states in repo pages.
6. Smoke test: Connect → Install on a private repo → verify → open in Repository.
