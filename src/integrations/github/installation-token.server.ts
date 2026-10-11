import { appJwtHeaders } from "./app-jwt.server";

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<number, CachedToken>();

/** Mint (and cache) an installation access token. Tokens live 1h, we refresh at 50min. */
export async function mintInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { method: "POST", headers: appJwtHeaders() },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Failed to mint installation token (${res.status}): ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(j.expires_at).getTime();
  tokenCache.set(installationId, { token: j.token, expiresAt });
  return j.token;
}

/**
 * Resolve an installation for a given GitHub account login (org or user) and mint a token.
 * Returns null if no installation is registered for that owner (caller should fall back to public).
 */
export async function getInstallationTokenForOwner(
  owner: string,
): Promise<{ token: string; installationId: number } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("github_app_installations")
    .select("id")
    .ilike("account_login", owner)
    .is("suspended_at", null)
    .maybeSingle();
  if (!data) return null;
  const token = await mintInstallationToken(Number(data.id));
  return { token, installationId: Number(data.id) };
}

/** Fetch installation metadata from GitHub (used by the install callback to upsert). */
export async function fetchInstallation(installationId: number) {
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: appJwtHeaders(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Failed to read installation ${installationId} (${res.status}): ${t.slice(0, 200)}`);
  }
  return (await res.json()) as {
    id: number;
    account: { login: string; id: number; type: string; avatar_url?: string };
    target_type: string;
    repository_selection: "all" | "selected";
    suspended_at: string | null;
  };
}

let cachedAppSlug: string | null = null;
export async function getAppSlug(): Promise<string> {
  if (cachedAppSlug) return cachedAppSlug;
  if (process.env.GITHUB_APP_SLUG) {
    cachedAppSlug = process.env.GITHUB_APP_SLUG;
    return cachedAppSlug;
  }
  const res = await fetch("https://api.github.com/app", { headers: appJwtHeaders() });
  if (!res.ok) throw new Error(`Failed to read App metadata (${res.status})`);
  const j = (await res.json()) as { slug: string };
  cachedAppSlug = j.slug;
  return cachedAppSlug;
}