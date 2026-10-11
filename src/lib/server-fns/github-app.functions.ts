import { createServerFn } from "@tanstack/react-start";
import { getRequestHost, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const STATE_COOKIE = "gh_app_oauth_state";

function originFromRequest(): string {
  const host = getRequestHost();
  // Lovable preview/published are both HTTPS
  return `https://${host}`;
}

/** Returns the GitHub authorize URL and sets a signed state cookie. */
export const startGithubOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    if (!clientId) throw new Error("GITHUB_APP_CLIENT_ID is not configured.");
    const origin = originFromRequest();
    const redirectUri = `${origin}/api/github/oauth/callback`;
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const state = `${context.userId}.${nonce}`;
    setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return { url: url.toString() };
  });

/** Returns the GitHub App install URL for the user to install/configure on selected orgs/repos. */
export const getInstallUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAppSlug } = await import("@/integrations/github/installation-token.server");
    const slug = await getAppSlug();
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const state = `${context.userId}.${nonce}`;
    setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    const url = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
    return { url };
  });

export const getGithubConnectionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: identity } = await supabaseAdmin
      .from("github_user_identities")
      .select("gh_login,gh_user_id,scopes,updated_at,oauth_expires_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { data: links } = await supabaseAdmin
      .from("github_installation_users")
      .select("installation_id, github_app_installations(id,account_login,account_type,account_avatar_url,repository_selection,suspended_at)")
      .eq("user_id", context.userId);
    const installations = (links ?? [])
      .map((l) => (l as { github_app_installations: unknown }).github_app_installations)
      .filter(Boolean) as Array<{
        id: number;
        account_login: string;
        account_type: string;
        account_avatar_url: string | null;
        repository_selection: "all" | "selected";
        suspended_at: string | null;
      }>;
    return {
      connected: !!identity,
      login: identity?.gh_login ?? null,
      installations,
    };
  });

export const disconnectGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await supabaseAdmin.from("github_installation_users").delete().eq("user_id", context.userId);
    await supabaseAdmin.from("github_user_identities").delete().eq("user_id", context.userId);
    return { ok: true };
  });

/** List repos a given installation can access (uses installation token). */
export const listInstallationRepos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ installationId: z.number().int().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    // Verify the user owns this installation link.
    const { data: link } = await supabaseAdmin
      .from("github_installation_users")
      .select("installation_id")
      .eq("user_id", context.userId)
      .eq("installation_id", data.installationId)
      .maybeSingle();
    if (!link) throw new Error("You don't have access to this installation.");

    const { mintInstallationToken } = await import("@/integrations/github/installation-token.server");
    const token = await mintInstallationToken(data.installationId);
    const res = await fetch("https://api.github.com/installation/repositories?per_page=100", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Cortex-Dev-Platform",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) throw new Error(`Failed to list repos (${res.status})`);
    const j = (await res.json()) as {
      total_count: number;
      repositories: Array<{
        full_name: string; private: boolean; default_branch: string;
        owner: { login: string }; name: string;
      }>;
    };
    return {
      total: j.total_count,
      repos: (j.repositories ?? []).map((r) => ({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
      })),
    };
  });