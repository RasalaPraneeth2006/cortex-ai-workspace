import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getInstallationTokenForOwner,
  mintInstallationToken,
} from "@/integrations/github/installation-token.server";

const RepoSchema = z.object({
  owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
});

/** Friendly, actionable error from a GitHub HTTP response. */
async function ghError(res: Response, ctx: { needsScope?: string; what: string }): Promise<Error> {
  const scopes = (res.headers.get("x-oauth-scopes") ?? "").trim();
  const accepted = (res.headers.get("x-accepted-oauth-scopes") ?? "").trim();
  let body: { message?: string } | null = null;
  try { body = (await res.json()) as { message?: string }; } catch { /* ignore */ }
  const base = body?.message ? `${body.message}` : `GitHub returned HTTP ${res.status}`;
  if (res.status === 401) {
    return new Error(
      `${ctx.what} failed: token rejected (401). Your GitHub token is invalid or expired. Disconnect and reconnect a new token at github.com/settings/tokens.`,
    );
  }
  if (res.status === 403) {
    const missing = ctx.needsScope && !scopes.split(",").map((s) => s.trim()).includes(ctx.needsScope);
    if (missing) {
      return new Error(
        `${ctx.what} forbidden (403). Your token is missing the "${ctx.needsScope}" scope. Current scopes: ${scopes || "(none)"}. Regenerate the token with ${accepted || ctx.needsScope}.`,
      );
    }
    return new Error(`${ctx.what} forbidden (403). ${base}. SSO may be required — visit your GitHub token page and click "Authorize" for the org.`);
  }
  if (res.status === 404) {
    return new Error(`${ctx.what}: not found or no access (404). The repository may be private and your token has no permission, or the org enforces SSO.`);
  }
  if (res.status === 429) {
    return new Error(`${ctx.what}: rate-limited by GitHub (429). Try again in a few minutes.`);
  }
  return new Error(`${ctx.what}: ${base} (HTTP ${res.status})`);
}

async function logAudit(args: {
  owner: string; repo: string; actorId: string | null; targetUserId?: string | null;
  action: string; details?: Record<string, unknown>;
}) {
  try {
    await supabaseAdmin.from("access_audit_logs").insert([{
      owner: args.owner,
      repo: args.repo,
      actor_id: args.actorId,
      target_user_id: args.targetUserId ?? args.actorId,
      action: args.action,
      details: (args.details ?? {}) as never,
    }]);
  } catch {
    // Never fail the user flow because of audit issues.
  }
}

async function ghHeadersForOwner(owner: string, userId: string): Promise<{ headers: Record<string, string>; installationId: number | null; viaUserInstall: boolean }> {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Cortex-Dev-Platform",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const installToken = await getInstallationTokenForOwner(owner);
    if (installToken) {
      // Check whether this user is linked to that installation
      const { data: link } = await supabaseAdmin
        .from("github_installation_users")
        .select("installation_id")
        .eq("installation_id", installToken.installationId)
        .eq("user_id", userId)
        .maybeSingle();
      return {
        headers: { ...base, Authorization: `Bearer ${installToken.token}` },
        installationId: installToken.installationId,
        viaUserInstall: !!link,
      };
    }
  } catch (e) {
    console.warn("[access] installation lookup failed for", owner, (e as Error).message);
  }
  return { headers: base, installationId: null, viaUserInstall: false };
}

/** Verify the caller's GitHub App installation grants access to {owner,repo}, and auto-claim the matching role. */
export const verifyAndClaimRepoAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RepoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { owner, repo } = data;
    const { userId } = context;

    const { headers: ghHeaders, installationId, viaUserInstall } = await ghHeadersForOwner(owner, userId);
    if (!installationId) {
      throw new Error(`The Cortex GitHub App is not installed on "${owner}". Open /access and install the app on that account first.`);
    }
    if (!viaUserInstall) {
      throw new Error(`The Cortex GitHub App is installed on "${owner}", but you haven't authorized it. Click "Connect GitHub" on /access, then retry.`);
    }

    // Probe repo (works for personal AND org repos when the user has any permission).
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: ghHeaders,
    });
    if (!res.ok) {
      if (res.status === 404) {
        await logAudit({ owner, repo, actorId: userId, action: "verify_github_access", details: { ok: false, reason: "not-selected-or-404" } });
        throw new Error(`The Cortex GitHub App can't see ${owner}/${repo}. Open the installation on GitHub and add this repo to the selected list.`);
      }
      const err = await ghError(res, { what: `Reading ${owner}/${repo}` });
      await logAudit({ owner, repo, actorId: userId, action: "verify_github_access", details: { ok: false, status: res.status, reason: err.message } });
      throw err;
    }
    const j = (await res.json()) as {
      private?: boolean;
      owner?: { type?: "User" | "Organization"; login?: string };
      permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; pull?: boolean };
    };
    const p = j.permissions ?? {};
    const isOrg = j.owner?.type === "Organization";

    // Org membership lookup isn't available with an installation token; rely on repo permissions only.
    const orgRole: "admin" | "member" | null = null;

    let role: "owner" | "admin" | "editor" | "viewer";
    if (p.admin) role = isOrg && orgRole !== "admin" ? "admin" : "owner";
    else if (p.maintain) role = "admin";
    else if (p.push) role = "editor";
    else if (p.pull) role = "viewer";
    else {
      throw new Error(
        `The Cortex GitHub App can see ${owner}/${repo} but has no permission level. Increase its repo permissions in the App settings, then retry.`,
      );
    }

    // Owner/admin -> upsert collaborator row. Editor/viewer -> grant repository_permissions.
    if (role === "owner" || role === "admin") {
      // Only allow self-claim of owner when there's no existing owner; otherwise upsert as admin.
      const { data: existing } = await supabaseAdmin
        .from("repository_collaborators")
        .select("id,role")
        .eq("owner", owner)
        .eq("repo", repo);
      const hasAnyOwner = (existing ?? []).some((c) => c.role === "owner");
      const finalRole = role === "owner" && hasAnyOwner ? "admin" : role;
      const { error } = await supabaseAdmin
        .from("repository_collaborators")
        .upsert({ owner, repo, user_id: userId, role: finalRole }, { onConflict: "owner,repo,user_id" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("repository_permissions")
        .upsert(
          {
            owner, repo, user_id: userId, role,
            granted_by: userId, granted_at: new Date().toISOString(),
            revoked_at: null, expires_at: null,
          },
          { onConflict: "owner,repo,user_id" },
        );
      if (error) throw new Error(error.message);
    }

    await logAudit({
      owner, repo, actorId: userId,
      action: "verify_github_access",
      details: { ok: true, role, private: !!j.private, isOrg, orgRole, ghPermissions: p },
    });

    return { ok: true, role, private: !!j.private, isOrg, orgRole };
  });

export type RepoAccessStatus = {
  owner: string;
  repo: string;
  exists: boolean;
  private: boolean | null;
  // GitHub-side: whether our shared token can read the repo
  tokenCanRead: boolean;
  // App-side: whether the user already has access (owner/admin/editor/viewer or active permission)
  appHasAccess: boolean;
  appRole: "owner" | "admin" | "editor" | "viewer" | null;
  // Owners/admins registered in our app for this repo (so requester knows who to ping)
  collaboratorCount: number;
  // If true, repo has no registered owner in our app yet — first signed-in user can self-claim
  ownerlessInApp: boolean;
  pendingRequestId: string | null;
  // Diagnostic fields for the verification status panel
  checkedAt: string;
  reason: string | null;
  usedUserToken: boolean;
};

/** Detect privacy + access without leaking any token. Public to authed users only. */
export const detectRepoAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RepoSchema.parse(d))
  .handler(async ({ data, context }): Promise<RepoAccessStatus> => {
    const { owner, repo } = data;
    const { userId } = context;

    // GitHub probe
    let exists = false;
    let isPrivate: boolean | null = null;
    let tokenCanRead = false;
    let reason: string | null = null;
    const { headers: probeHeaders, installationId, viaUserInstall } = await ghHeadersForOwner(owner, userId);
    const usedUserToken = viaUserInstall;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: probeHeaders,
    });
    if (res.status === 200) {
      const j = (await res.json()) as { private?: boolean };
      exists = true;
      isPrivate = !!j.private;
      tokenCanRead = true;
    } else if (res.status === 404) {
      exists = false;
      isPrivate = null;
      tokenCanRead = false;
      reason = installationId
        ? `The GitHub App installation on "${owner}" can't see ${owner}/${repo}. Add this repo to the installation on GitHub.`
        : `The Cortex GitHub App is not installed on "${owner}". Click "Install GitHub App" above.`;
    } else if (res.status === 401 || res.status === 403) {
      exists = true;
      isPrivate = true;
      tokenCanRead = false;
      reason = `GitHub returned ${res.status}. The App installation may lack permissions for this repo.`;
    } else {
      reason = `Unexpected GitHub response: ${res.status}`;
    }

    // App-side checks
    const [{ data: collab }, { data: perm }, { data: pending }, { count }] = await Promise.all([
      supabaseAdmin
        .from("repository_collaborators")
        .select("role")
        .eq("owner", owner)
        .eq("repo", repo)
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("repository_permissions")
        .select("role,expires_at,revoked_at")
        .eq("owner", owner)
        .eq("repo", repo)
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("repository_access_requests")
        .select("id")
        .eq("owner", owner)
        .eq("repo", repo)
        .eq("requester_id", userId)
        .eq("status", "pending")
        .maybeSingle(),
      supabaseAdmin
        .from("repository_collaborators")
        .select("*", { count: "exact", head: true })
        .eq("owner", owner)
        .eq("repo", repo),
    ]);

    let appRole: RepoAccessStatus["appRole"] = null;
    let appHasAccess = false;
    if (collab?.role) {
      appRole = collab.role as RepoAccessStatus["appRole"];
      appHasAccess = true;
    } else if (perm && !perm.revoked_at && (!perm.expires_at || new Date(perm.expires_at) > new Date())) {
      appRole = perm.role as RepoAccessStatus["appRole"];
      appHasAccess = true;
    }

    const result: RepoAccessStatus = {
      owner,
      repo,
      exists: exists || (count ?? 0) > 0,
      private: isPrivate,
      tokenCanRead,
      appHasAccess,
      appRole,
      collaboratorCount: count ?? 0,
      ownerlessInApp: (count ?? 0) === 0,
      pendingRequestId: pending?.id ?? null,
      checkedAt: new Date().toISOString(),
      reason,
      usedUserToken,
    };

    await logAudit({
      owner, repo, actorId: userId, action: "detect_repo_access",
      details: {
        ghStatus: res.status,
        appRole, appHasAccess,
        private: isPrivate, tokenCanRead, usedUserToken, reason,
      },
    });

    return result;
  });

/** Self-claim ownership of a repo when no app collaborator exists yet (gated by RLS too). */
export const claimRepoOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RepoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { owner, repo } = data;
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("repository_collaborators")
      .insert({ owner, repo, user_id: userId, role: "owner" });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("access_audit_logs").insert({
      owner, repo, actor_id: userId, target_user_id: userId,
      action: "claim_owner", details: {},
    });
    return { ok: true };
  });

/** Returns the caller's own audit log entries (recent first). */
export const listMyAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: rows, error } = await supabaseAdmin
      .from("access_audit_logs")
      .select("id,owner,repo,action,details,created_at,actor_id,target_user_id")
      .or(`actor_id.eq.${userId},target_user_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { logs: rows ?? [] };
  });

const RequestSchema = RepoSchema.extend({
  message: z.string().max(2000).optional(),
  requestedRole: z.enum(["viewer", "editor"]).default("viewer"),
});

/** Create or refresh a pending access request. */
export const createAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RequestSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { owner, repo, message, requestedRole } = data;
    const { supabase, userId } = context;

    // Dedupe pending
    const { data: existing } = await supabase
      .from("repository_access_requests")
      .select("id")
      .eq("owner", owner).eq("repo", repo)
      .eq("requester_id", userId).eq("status", "pending")
      .maybeSingle();
    if (existing) return { id: existing.id, deduped: true };

    const { data: row, error } = await supabase
      .from("repository_access_requests")
      .insert({
        owner, repo,
        requester_id: userId,
        requested_role: requestedRole,
        message: message ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, deduped: false };
  });

/** Requester cancels own pending request. */
export const cancelAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("repository_access_requests")
      .update({ status: "revoked", reviewed_at: new Date().toISOString(), reviewed_by: userId, review_note: "cancelled by requester" })
      .eq("id", data.id)
      .eq("requester_id", userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DecisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  role: z.enum(["viewer", "editor", "admin"]).default("viewer"),
  expiresInHours: z.number().int().min(1).max(24 * 365).optional(),
  note: z.string().max(2000).optional(),
});

/** Owner/admin decides on a pending request. */
export const decideAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DecisionSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load request (RLS ensures caller is owner/admin or requester)
    const { data: req, error: reqErr } = await supabase
      .from("repository_access_requests")
      .select("id,owner,repo,requester_id,status")
      .eq("id", data.id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req || req.status !== "pending") throw new Error("Request not pending");

    // Re-verify the caller is an owner/admin via RPC (defense in depth)
    const { data: isAdmin } = await supabase.rpc("has_repo_role", {
      _user: userId, _owner: req.owner, _repo: req.repo,
      _roles: ["owner", "admin"],
    });
    if (!isAdmin) throw new Error("Forbidden");

    const now = new Date();
    const expires = data.expiresInHours
      ? new Date(now.getTime() + data.expiresInHours * 3600 * 1000).toISOString()
      : null;

    if (data.decision === "approve") {
      const { error: upErr } = await supabase
        .from("repository_permissions")
        .upsert({
          owner: req.owner, repo: req.repo,
          user_id: req.requester_id,
          role: data.role,
          granted_by: userId,
          granted_at: now.toISOString(),
          expires_at: expires,
          revoked_at: null,
        }, { onConflict: "owner,repo,user_id" });
      if (upErr) throw new Error(upErr.message);
    }

    const { error: updErr } = await supabase
      .from("repository_access_requests")
      .update({
        status: data.decision === "approve" ? "approved" : "rejected",
        reviewed_at: now.toISOString(),
        reviewed_by: userId,
        review_note: data.note ?? null,
        expires_at: expires,
      })
      .eq("id", req.id);
    if (updErr) throw new Error(updErr.message);

    await supabase.from("access_audit_logs").insert({
      owner: req.owner, repo: req.repo,
      actor_id: userId, target_user_id: req.requester_id,
      action: data.decision === "approve" ? "approve_request" : "reject_request",
      details: { request_id: req.id, role: data.role, expires_at: expires, note: data.note ?? null },
    });

    return { ok: true };
  });

/** Revoke or update an existing permission. */
export const revokeRepoPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ permissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: perm, error: pErr } = await supabase
      .from("repository_permissions")
      .select("id,owner,repo,user_id")
      .eq("id", data.permissionId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!perm) throw new Error("Permission not found");

    const { error } = await supabase
      .from("repository_permissions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.permissionId);
    if (error) throw new Error(error.message);

    await supabase.from("access_audit_logs").insert({
      owner: perm.owner, repo: perm.repo,
      actor_id: userId, target_user_id: perm.user_id,
      action: "revoke_permission", details: { permission_id: perm.id },
    });
    return { ok: true };
  });

/** Lists pending + recent requests for repos where caller is owner/admin. */
export const listIncomingRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: collabs } = await supabase
      .from("repository_collaborators")
      .select("owner,repo,role")
      .eq("user_id", userId)
      .in("role", ["owner", "admin"]);
    if (!collabs || collabs.length === 0) return { requests: [], repos: [] };

    const repos = collabs.map((c) => ({ owner: c.owner, repo: c.repo, role: c.role }));
    // Build OR filter
    const filters = collabs
      .map((c) => `and(owner.eq.${c.owner},repo.eq.${c.repo})`)
      .join(",");
    const { data, error } = await supabase
      .from("repository_access_requests")
      .select("*")
      .or(filters)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // Pull requester profiles
    const requesterIds = Array.from(new Set((data ?? []).map((r) => r.requester_id)));
    const profileMap = new Map<string, { username: string; display_name: string; avatar_url: string | null }>();
    if (requesterIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url")
        .in("id", requesterIds);
      profs?.forEach((p) =>
        profileMap.set(p.id, { username: p.username, display_name: p.display_name, avatar_url: p.avatar_url }),
      );
    }

    return {
      repos,
      requests: (data ?? []).map((r) => ({ ...r, requester: profileMap.get(r.requester_id) ?? null })),
    };
  });

/** Lists caller's own requests + active permissions. */
export const listMyRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: reqs }, { data: perms }] = await Promise.all([
      supabase
        .from("repository_access_requests")
        .select("*")
        .eq("requester_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("repository_permissions")
        .select("*")
        .eq("user_id", userId)
        .order("granted_at", { ascending: false })
        .limit(100),
    ]);
    return { requests: reqs ?? [], permissions: perms ?? [] };
  });

/** Lists collaborators + permissions for a repo the caller administers. */
export const listRepoMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RepoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_repo_role", {
      _user: userId, _owner: data.owner, _repo: data.repo,
      _roles: ["owner", "admin"],
    });
    if (!isAdmin) throw new Error("Forbidden");

    const [{ data: collabs }, { data: perms }] = await Promise.all([
      supabase.from("repository_collaborators").select("*").eq("owner", data.owner).eq("repo", data.repo),
      supabase.from("repository_permissions").select("*").eq("owner", data.owner).eq("repo", data.repo),
    ]);
    const ids = Array.from(new Set([...(collabs ?? []).map((c) => c.user_id), ...(perms ?? []).map((p) => p.user_id)]));
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id,username,display_name,avatar_url").in("id", ids)
      : { data: [] as { id: string; username: string; display_name: string; avatar_url: string | null }[] };
    const map = new Map(profs!.map((p) => [p.id, p]));
    return {
      collaborators: (collabs ?? []).map((c) => ({ ...c, profile: map.get(c.user_id) ?? null })),
      permissions: (perms ?? []).map((p) => ({ ...p, profile: map.get(p.user_id) ?? null })),
    };
  });