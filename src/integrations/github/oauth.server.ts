/** Exchange an OAuth code for a user access token (and refresh token, if expiring tokens are enabled). */
export async function exchangeCode(code: string, redirectUri: string) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub App OAuth is not configured.");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`OAuth code exchange failed (${res.status})`);
  const j = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (j.error || !j.access_token) {
    throw new Error(`OAuth exchange error: ${j.error_description ?? j.error ?? "unknown"}`);
  }
  return j;
}

export async function refreshUserToken(refreshToken: string) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub App OAuth is not configured.");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`OAuth refresh failed (${res.status})`);
  return (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    refresh_token_expires_in: number;
  };
}

/** GET the OAuth'd user's profile to know who they are on GitHub. */
export async function fetchOAuthUser(accessToken: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Cortex-Dev-Platform",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to read GitHub user (${res.status})`);
  return (await res.json()) as { id: number; login: string };
}

/** List installations the OAuth'd user has access to. Used to link installations to a user. */
export async function listUserInstallations(accessToken: string) {
  const res = await fetch("https://api.github.com/user/installations?per_page=100", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Cortex-Dev-Platform",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to list user installations (${res.status})`);
  const j = (await res.json()) as {
    total_count: number;
    installations: Array<{
      id: number;
      account: { login: string; id: number; type: string; avatar_url?: string };
      target_type: string;
      repository_selection: "all" | "selected";
      suspended_at: string | null;
    }>;
  };
  return j.installations ?? [];
}