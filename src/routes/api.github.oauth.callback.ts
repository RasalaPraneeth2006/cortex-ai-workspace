import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCookie, deleteCookie } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptToken } from "@/integrations/crypto/token-cipher.server";
import { exchangeCode, fetchOAuthUser, listUserInstallations } from "@/integrations/github/oauth.server";
import { fetchInstallation } from "@/integrations/github/installation-token.server";

const STATE_COOKIE = "gh_app_oauth_state";

function htmlError(message: string, status = 400) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>GitHub connection error</title>
<body style="font-family:system-ui;background:#0b0e14;color:#e6e6e6;padding:32px;">
<h2>GitHub connection failed</h2>
<p>${message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</p>
<p><a href="/access" style="color:#7aa2f7">Back to access</a></p>
</body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/github/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const installationIdRaw = url.searchParams.get("installation_id");
        const setupAction = url.searchParams.get("setup_action");

        // Resolve the Cortex user from the signed state cookie.
        const cookieState = getCookie(STATE_COOKIE);
        if (!cookieState || !state || cookieState !== state) {
          return htmlError("OAuth state mismatch. Please restart the connection from /access.");
        }
        // state format: <userId>.<nonce>
        const userId = state.split(".")[0];
        if (!userId || userId.length < 20) return htmlError("Invalid state.");
        deleteCookie(STATE_COOKIE);

        try {
          // 1) User OAuth (?code) — happens when "Authorize" page completed.
          if (code) {
            const redirectUri = `${url.origin}/api/github/oauth/callback`;
            const tok = await exchangeCode(code, redirectUri);
            const me = await fetchOAuthUser(tok.access_token!);
            await supabaseAdmin.from("github_user_identities").upsert({
              user_id: userId,
              gh_user_id: me.id,
              gh_login: me.login,
              oauth_access_token_enc: encryptToken(tok.access_token!),
              oauth_refresh_token_enc: tok.refresh_token ? encryptToken(tok.refresh_token) : null,
              oauth_expires_at: tok.expires_in
                ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
                : null,
              oauth_refresh_expires_at: tok.refresh_token_expires_in
                ? new Date(Date.now() + tok.refresh_token_expires_in * 1000).toISOString()
                : null,
              scopes: tok.scope ?? null,
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id" });

            // Pull installations the user can see and link them.
            try {
              const installs = await listUserInstallations(tok.access_token!);
              if (installs.length) {
                await supabaseAdmin.from("github_app_installations").upsert(
                  installs.map((i) => ({
                    id: i.id,
                    account_login: i.account.login,
                    account_id: i.account.id,
                    account_type: i.account.type,
                    target_type: i.target_type,
                    repository_selection: i.repository_selection,
                    account_avatar_url: i.account.avatar_url ?? null,
                    suspended_at: i.suspended_at,
                  })),
                  { onConflict: "id" },
                );
                await supabaseAdmin.from("github_installation_users").upsert(
                  installs.map((i) => ({ installation_id: i.id, user_id: userId })),
                  { onConflict: "installation_id,user_id" },
                );
              }
            } catch (e) {
              console.warn("[gh-oauth] listing installations failed:", (e as Error).message);
            }
          }

          // 2) Installation callback (?installation_id) — happens after Install/Configure.
          if (installationIdRaw) {
            const installationId = Number(installationIdRaw);
            if (Number.isFinite(installationId) && setupAction !== "request") {
              const i = await fetchInstallation(installationId);
              await supabaseAdmin.from("github_app_installations").upsert({
                id: i.id,
                account_login: i.account.login,
                account_id: i.account.id,
                account_type: i.account.type,
                target_type: i.target_type,
                repository_selection: i.repository_selection,
                account_avatar_url: i.account.avatar_url ?? null,
                suspended_at: i.suspended_at,
              }, { onConflict: "id" });
              await supabaseAdmin.from("github_installation_users").upsert(
                { installation_id: i.id, user_id: userId },
                { onConflict: "installation_id,user_id" },
              );
            }
          }

          throw redirect({ to: "/access" });
        } catch (e) {
          // redirect throws are Response objects already
          if (e instanceof Response) return e;
          return htmlError((e as Error).message ?? "Unknown error", 500);
        }
      },
    },
  },
});