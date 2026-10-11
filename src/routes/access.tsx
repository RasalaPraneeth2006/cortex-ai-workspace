import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Github, Lock, Unlock, ShieldCheck, ShieldAlert, Send, CheckCircle2, XCircle, Clock, RotateCcw, KeySquare, UserPlus, ScrollText, Loader2, AlertTriangle, Plug, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

import {
  detectRepoAccess,
  createAccessRequest,
  cancelAccessRequest,
  claimRepoOwnership,
  decideAccessRequest,
  revokeRepoPermission,
  listIncomingRequests,
  listMyRequests,
  verifyAndClaimRepoAccess,
  listMyAuditLogs,
  type RepoAccessStatus,
} from "@/lib/server-fns/access.functions";
import {
  startGithubOAuth,
  getInstallUrl,
  getGithubConnectionStatus,
  disconnectGithub,
} from "@/lib/server-fns/github-app.functions";

export const Route = createFileRoute("/access")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: AccessPage,
  head: () => ({
    meta: [
      { title: "Repository access · Cortex" },
      { name: "description", content: "Request and manage access to private repositories." },
    ],
  }),
});

const REPO_URL_RE = /(?:github\.com\/)?([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+?)(?:\.git)?(?:\/|$)/;

function parseRepo(input: string): { owner: string; repo: string } | null {
  const t = input.trim();
  if (!t) return null;
  const m = t.match(REPO_URL_RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30", icon: <Clock className="h-3 w-3" /> },
    approved: { label: "Approved", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="h-3 w-3" /> },
    rejected: { label: "Rejected", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30", icon: <XCircle className="h-3 w-3" /> },
    revoked: { label: "Revoked", cls: "bg-muted text-muted-foreground border-border", icon: <RotateCcw className="h-3 w-3" /> },
    expired: { label: "Expired", cls: "bg-muted text-muted-foreground border-border", icon: <Clock className="h-3 w-3" /> },
  };
  const cfg = map[status] ?? map.pending;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.cls}`}>{cfg.icon}{cfg.label}</Badge>
  );
}

function AccessPage() {
  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-display font-semibold tracking-tight">Repository Access</h1>
        <p className="text-sm text-muted-foreground">
          Detect privacy, check access, request access to private repos, and manage approvals.
        </p>
      </header>

      <Tabs defaultValue="check" className="space-y-4">
        <TabsList>
          <TabsTrigger value="check">Check / Request</TabsTrigger>
          <TabsTrigger value="incoming">Incoming requests</TabsTrigger>
          <TabsTrigger value="mine">My access</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="check"><CheckPanel /></TabsContent>
        <TabsContent value="incoming"><IncomingPanel /></TabsContent>
        <TabsContent value="mine"><MyAccessPanel /></TabsContent>
        <TabsContent value="audit"><AuditPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────── Check / Request ───────────────── */

function CheckPanel() {
  const qc = useQueryClient();
  const detect = useServerFn(detectRepoAccess);
  const request = useServerFn(createAccessRequest);
  const claim = useServerFn(claimRepoOwnership);
  const verify = useServerFn(verifyAndClaimRepoAccess);

  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<RepoAccessStatus | null>(null);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");

  const parsed = useMemo(() => parseRepo(url), [url]);

  const detectMut = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error("Paste a valid GitHub URL or owner/repo");
      return await detect({ data: parsed });
    },
    onSuccess: (s) => setStatus(s),
    onError: (e: Error) => toast.error(e.message),
  });

  const requestMut = useMutation({
    mutationFn: async () => {
      if (!status) throw new Error("Check the repo first");
      return await request({ data: { owner: status.owner, repo: status.repo, message, requestedRole: role } });
    },
    onSuccess: async (r) => {
      toast.success(r.deduped ? "You already have a pending request." : "Access request sent.");
      if (parsed) {
        const fresh = await detect({ data: parsed });
        setStatus(fresh);
      }
      qc.invalidateQueries({ queryKey: ["myRequests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const claimMut = useMutation({
    mutationFn: async () => {
      if (!status) throw new Error("Check the repo first");
      return await claim({ data: { owner: status.owner, repo: status.repo } });
    },
    onSuccess: async () => {
      toast.success("You're now the owner in Cortex for this repo.");
      if (parsed) setStatus(await detect({ data: parsed }));
      qc.invalidateQueries({ queryKey: ["incomingRequests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyMut = useMutation({
    mutationFn: async () => {
      if (!status) throw new Error("Check the repo first");
      return await verify({ data: { owner: status.owner, repo: status.repo } });
    },
    onSuccess: async (r) => {
      toast.success(`Granted ${r.role} access via your GitHub token.`);
      if (parsed) setStatus(await detect({ data: parsed }));
      qc.invalidateQueries({ queryKey: ["incomingRequests"] });
      qc.invalidateQueries({ queryKey: ["myRequests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <GithubConnectionCard />
      <VerificationStatusPanel
        loading={detectMut.isPending || verifyMut.isPending}
        status={status}
        lastError={(detectMut.error as Error | null)?.message ?? (verifyMut.error as Error | null)?.message ?? null}
        lastVerify={verifyMut.data ?? null}
      />
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Github className="h-5 w-5" /> Check repository access</CardTitle>
        <CardDescription>Paste a GitHub URL or <code className="text-xs">owner/repo</code>. We'll detect privacy and your current access.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="https://github.com/owner/repo or owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && detectMut.mutate()}
          />
          <Button onClick={() => detectMut.mutate()} disabled={!parsed || detectMut.isPending}>
            {detectMut.isPending ? "Checking…" : "Check"}
          </Button>
        </div>

        {status && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-sm">{status.owner}/{status.repo}</span>
              {status.private === true ? (
                <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-400 border-amber-500/30"><Lock className="h-3 w-3" /> Private</Badge>
              ) : status.private === false ? (
                <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30"><Unlock className="h-3 w-3" /> Public</Badge>
              ) : (
                <Badge variant="outline" className="gap-1"><ShieldAlert className="h-3 w-3" /> Unknown / not found</Badge>
              )}
              {status.appHasAccess ? (
                <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                  <ShieldCheck className="h-3 w-3" /> Access: {status.appRole}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 bg-rose-500/10 text-rose-400 border-rose-500/30">
                  <ShieldAlert className="h-3 w-3" /> No access in Cortex
                </Badge>
              )}
              {status.tokenCanRead ? (
                <Badge variant="outline" className="gap-1">Token can read</Badge>
              ) : status.private ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground">Token can't read</Badge>
              ) : null}
              {status.ownerlessInApp && (
                <Badge variant="outline" className="gap-1 bg-primary/10 text-primary border-primary/30">No registered owner</Badge>
              )}
            </div>

            {status.appHasAccess ? (
              <p className="text-sm text-emerald-400">You already have access ({status.appRole}). Open the editor or repo chat to use it.</p>
            ) : (
              <div className="space-y-2">
                {status.ownerlessInApp && (
                  <p className="text-sm text-muted-foreground">
                    No one in Cortex has claimed this repo yet. If you own or admin it on GitHub, you can claim it here.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {status.ownerlessInApp && (
                    <Button size="sm" variant="outline" onClick={() => claimMut.mutate()} disabled={claimMut.isPending}>
                      <KeySquare className="h-4 w-4 mr-1" /> Claim ownership
                    </Button>
                  )}
                  <Button size="sm" onClick={() => verifyMut.mutate()} disabled={verifyMut.isPending}>
                    <ShieldCheck className="h-4 w-4 mr-1" /> {verifyMut.isPending ? "Verifying…" : "Verify with my GitHub"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Verifying uses your connected GitHub token to grant the matching role automatically.
                </p>
              </div>
            )}

            {!status.appHasAccess && status.pendingRequestId && (
              <p className="text-sm text-amber-400">
                You already have a pending request for this repo. The owner will see it in their inbox.
              </p>
            )}
            {!status.appHasAccess && !status.pendingRequestId && !status.ownerlessInApp && (
              <div className="space-y-3">
                <Separator />
                <div className="grid sm:grid-cols-[1fr_180px] gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Message to owner</Label>
                    <Textarea
                      placeholder="Why do you need access?"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={3}
                      maxLength={2000}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Requested role</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as "viewer" | "editor")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">Viewer (read)</SelectItem>
                        <SelectItem value="editor">Editor (write)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button className="w-full mt-2" onClick={() => requestMut.mutate()} disabled={requestMut.isPending}>
                      <Send className="h-4 w-4 mr-1" /> {requestMut.isPending ? "Sending…" : "Request access"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

/* ───────────────── GitHub App connection ───────────────── */

function GithubConnectionCard() {
  const qc = useQueryClient();
  const status = useServerFn(getGithubConnectionStatus);
  const startOAuth = useServerFn(startGithubOAuth);
  const installUrl = useServerFn(getInstallUrl);
  const disconnect = useServerFn(disconnectGithub);

  const q = useQuery({
    queryKey: ["ghAppStatus"],
    queryFn: () => status({ data: undefined as never }),
  });

  const connectMut = useMutation({
    mutationFn: async () => startOAuth({ data: undefined as never }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e: Error) => toast.error(e.message),
  });

  const installMut = useMutation({
    mutationFn: async () => installUrl({ data: undefined as never }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMut = useMutation({
    mutationFn: async () => disconnect({ data: undefined as never }),
    onSuccess: () => {
      toast.success("GitHub disconnected.");
      qc.invalidateQueries({ queryKey: ["ghAppStatus"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Github className="h-4 w-4" /> GitHub connection
        </CardTitle>
        <CardDescription>
          Sign in with GitHub and install the Cortex App on the orgs or repos you want to use.
          No personal access tokens required — the App's scoped installation token is used for every call.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : q.data?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="text-sm">
                <span className="text-emerald-400 font-medium">Connected</span>
                {q.data.login && <span className="text-muted-foreground"> · @{q.data.login}</span>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => installMut.mutate()} disabled={installMut.isPending}>
                  <Plus className="h-4 w-4 mr-1" /> Install / configure
                </Button>
                <Button variant="outline" size="sm" onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending}>
                  Disconnect
                </Button>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">App installations ({q.data.installations.length})</p>
              {q.data.installations.length === 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  No installations yet. Click <strong>Install / configure</strong> above to grant access to repos.
                </div>
              ) : (
                <div className="space-y-2">
                  {q.data.installations.map((i) => (
                    <div key={i.id} className="flex items-center gap-3 rounded-md border border-border/60 p-2 bg-muted/20">
                      <Avatar className="h-7 w-7">
                        {i.account_avatar_url && <AvatarImage src={i.account_avatar_url} />}
                        <AvatarFallback className="text-[10px]">{(i.account_login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-tight">{i.account_login}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight">
                          {i.account_type} · {i.repository_selection === "all" ? "all repos" : "selected repos"}
                          {i.suspended_at ? " · suspended" : ""}
                        </p>
                      </div>
                      <a
                        href={`https://github.com/${i.account_type === "Organization" ? "organizations/" + i.account_login + "/settings/installations/" + i.id : "settings/installations/" + i.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline text-muted-foreground hover:text-foreground"
                      >
                        Manage on GitHub
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => connectMut.mutate()} disabled={connectMut.isPending}>
              <Plug className="h-4 w-4 mr-1" />
              {connectMut.isPending ? "Redirecting…" : "Connect GitHub"}
            </Button>
            <Button variant="outline" onClick={() => installMut.mutate()} disabled={installMut.isPending}>
              <Plus className="h-4 w-4 mr-1" />
              Install GitHub App
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────── Incoming requests (owner/admin) ───────────────── */

function IncomingPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listIncomingRequests);
  const { user } = useAuth();

  const q = useQuery({
    queryKey: ["incomingRequests"],
    queryFn: () => list({ data: undefined as never }),
  });

  // Realtime: refresh on any change to access requests for my admin repos
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("incoming-access-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "repository_access_requests" }, () => {
        qc.invalidateQueries({ queryKey: ["incomingRequests"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  if (q.isLoading) return <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  const reqs = q.data?.requests ?? [];
  const repos = q.data?.repos ?? [];

  if (!repos.length) {
    return (
      <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
        You aren't an owner or admin of any repo in Cortex yet. Claim a repo from the Check tab to start receiving requests.
      </CardContent></Card>
    );
  }

  const pending = reqs.filter((r) => r.status === "pending");
  const history = reqs.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending ({pending.length})</CardTitle>
          <CardDescription>Approve, reject, or grant temporary access.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.length === 0 && <p className="text-sm text-muted-foreground">No pending requests.</p>}
          {pending.map((r) => <RequestRow key={r.id} req={r} />)}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {history.map((r) => <RequestRow key={r.id} req={r} historical />)}
          </CardContent>
        </Card>
      )}

      <RepoMembersSection repos={repos as { owner: string; repo: string; role: string }[]} />
    </div>
  );
}

type IncomingReq = {
  id: string; owner: string; repo: string; requester_id: string;
  requested_role: string; message: string | null; status: string;
  created_at: string; reviewed_at: string | null; review_note: string | null;
  expires_at: string | null;
  requester: { username: string; display_name: string; avatar_url: string | null } | null;
};

function RequestRow({ req, historical }: { req: IncomingReq; historical?: boolean }) {
  const decide = useServerFn(decideAccessRequest);
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [role, setRole] = useState<"viewer" | "editor" | "admin">("viewer");
  const [temporary, setTemporary] = useState(false);
  const [hours, setHours] = useState(24);
  const [note, setNote] = useState("");
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: async () => decide({
      data: { id: req.id, decision, role, expiresInHours: temporary ? hours : undefined, note: note || undefined },
    }),
    onSuccess: () => {
      toast.success(decision === "approve" ? "Approved." : "Rejected.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["incomingRequests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const initials = (req.requester?.display_name ?? req.requester?.username ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3 bg-muted/20">
      <Avatar className="h-9 w-9">
        {req.requester?.avatar_url && <AvatarImage src={req.requester.avatar_url} />}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{req.requester?.display_name ?? "Unknown user"}</span>
          <span className="text-xs text-muted-foreground">@{req.requester?.username ?? "?"}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="font-mono text-xs">{req.owner}/{req.repo}</span>
          <Badge variant="outline" className="text-[10px]">wants {req.requested_role}</Badge>
          {statusBadge(req.status)}
        </div>
        {req.message && <p className="text-sm text-muted-foreground line-clamp-3">{req.message}</p>}
        <p className="text-[11px] text-muted-foreground">
          {new Date(req.created_at).toLocaleString()}
          {req.review_note && historical ? ` · note: ${req.review_note}` : ""}
        </p>
      </div>
      {!historical && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setDecision("reject"); setOpen(true); }}>Reject</Button>
          <Button size="sm" onClick={() => { setDecision("approve"); setOpen(true); }}>Approve</Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "approve" ? "Approve access" : "Reject request"}</DialogTitle>
            <DialogDescription>
              {req.requester?.display_name ?? "User"} wants {req.requested_role} access to <span className="font-mono">{req.owner}/{req.repo}</span>.
            </DialogDescription>
          </DialogHeader>

          {decision === "approve" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Grant role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input id="temp" type="checkbox" className="h-4 w-4" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
                <Label htmlFor="temp" className="text-sm">Grant temporary access</Label>
                {temporary && (
                  <Input
                    type="number" min={1} max={8760} value={hours}
                    onChange={(e) => setHours(Math.max(1, Number(e.target.value) || 1))}
                    className="w-24 ml-2"
                  />
                )}
                {temporary && <span className="text-xs text-muted-foreground">hours</span>}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Note (optional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
              {mut.isPending ? "Saving…" : decision === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────── Repo members ───────────────── */

function RepoMembersSection({ repos }: { repos: { owner: string; repo: string; role: string }[] }) {
  const [selected, setSelected] = useState<string>(`${repos[0].owner}/${repos[0].repo}`);
  const [owner, repo] = selected.split("/");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Collaborators</CardTitle>
            <CardDescription>Manage who has access in Cortex.</CardDescription>
          </div>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {repos.map((r) => (
                <SelectItem key={`${r.owner}/${r.repo}`} value={`${r.owner}/${r.repo}`}>
                  {r.owner}/{r.repo} · {r.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <MembersList owner={owner} repo={repo} />
      </CardContent>
    </Card>
  );
}

function MembersList({ owner, repo }: { owner: string; repo: string }) {
  const qc = useQueryClient();
  const [data, setData] = useState<{
    collaborators: Array<{ id: string; user_id: string; role: string; profile: { username: string; display_name: string; avatar_url: string | null } | null }>;
    permissions: Array<{ id: string; user_id: string; role: string; expires_at: string | null; revoked_at: string | null; granted_at: string; profile: { username: string; display_name: string; avatar_url: string | null } | null }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const revoke = useServerFn(revokeRepoPermission);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    import("@/lib/server-fns/access.functions").then(async ({ listRepoMembers }) => {
      try {
        // listRepoMembers is a server fn — call directly via its RPC stub
        const res = await (listRepoMembers as unknown as (a: { data: { owner: string; repo: string } }) => Promise<typeof data>)({ data: { owner, repo } });
        if (!cancelled) setData(res);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [owner, repo]);

  const revokeMut = useMutation({
    mutationFn: async (permissionId: string) => revoke({ data: { permissionId } }),
    onSuccess: () => { toast.success("Access revoked."); qc.invalidateQueries({ queryKey: ["incomingRequests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <Skeleton className="h-24 w-full" />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">App roles</p>
        <div className="space-y-2">
          {data.collaborators.map((c) => (
            <MemberRow key={c.id} profile={c.profile} userId={c.user_id} role={c.role} />
          ))}
          {data.collaborators.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        </div>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Granted permissions</p>
        <div className="space-y-2">
          {data.permissions.map((p) => {
            const expired = p.expires_at && new Date(p.expires_at) <= new Date();
            const revoked = !!p.revoked_at;
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-md border border-border/60 p-2 bg-muted/20">
                <MemberRow profile={p.profile} userId={p.user_id} role={p.role} inline />
                {p.expires_at && !revoked && (
                  <Badge variant="outline" className="text-[10px]">
                    {expired ? "Expired" : `Expires ${new Date(p.expires_at).toLocaleDateString()}`}
                  </Badge>
                )}
                {revoked && <Badge variant="outline" className="text-[10px]">Revoked</Badge>}
                {!revoked && !expired && (
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => revokeMut.mutate(p.id)} disabled={revokeMut.isPending}>
                    Revoke
                  </Button>
                )}
              </div>
            );
          })}
          {data.permissions.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  profile, userId, role, inline,
}: {
  profile: { username: string; display_name: string; avatar_url: string | null } | null;
  userId: string; role: string; inline?: boolean;
}) {
  const initials = (profile?.display_name ?? profile?.username ?? userId).slice(0, 2).toUpperCase();
  return (
    <div className={`flex items-center gap-3 ${inline ? "" : "rounded-md border border-border/60 p-2 bg-muted/20"}`}>
      <Avatar className="h-7 w-7">
        {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-sm leading-tight">{profile?.display_name ?? "Unknown"}</p>
        <p className="text-[11px] text-muted-foreground leading-tight">@{profile?.username ?? "?"}</p>
      </div>
      <Badge variant="outline" className="text-[10px] ml-2">{role}</Badge>
    </div>
  );
}

/* ───────────────── My access ───────────────── */

function MyAccessPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listMyRequests);
  const cancel = useServerFn(cancelAccessRequest);
  const { user } = useAuth();

  const q = useQuery({ queryKey: ["myRequests"], queryFn: () => list({ data: undefined as never }) });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("my-access-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "repository_access_requests", filter: `requester_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["myRequests"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "repository_permissions", filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["myRequests"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancel({ data: { id } }),
    onSuccess: () => { toast.success("Request cancelled."); qc.invalidateQueries({ queryKey: ["myRequests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-32 w-full" />;

  const reqs = q.data?.requests ?? [];
  const perms = (q.data?.permissions ?? []) as Array<{ id: string; owner: string; repo: string; role: string; granted_at: string; expires_at: string | null; revoked_at: string | null }>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4" /> Active access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {perms.length === 0 && <p className="text-sm text-muted-foreground">No granted permissions yet.</p>}
          {perms.map((p) => {
            const expired = p.expires_at && new Date(p.expires_at) <= new Date();
            const active = !p.revoked_at && !expired;
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-md border border-border/60 p-3 bg-muted/20">
                <span className="font-mono text-sm">{p.owner}/{p.repo}</span>
                <Badge variant="outline" className="text-[10px]">{p.role}</Badge>
                {active && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Active</Badge>}
                {p.revoked_at && <Badge variant="outline" className="text-[10px]">Revoked</Badge>}
                {expired && !p.revoked_at && <Badge variant="outline" className="text-[10px]">Expired</Badge>}
                {p.expires_at && active && (
                  <span className="text-[11px] text-muted-foreground ml-auto">Expires {new Date(p.expires_at).toLocaleString()}</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">My requests</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {reqs.length === 0 && <p className="text-sm text-muted-foreground">You haven't requested access to any private repo yet.</p>}
          {reqs.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-md border border-border/60 p-3 bg-muted/20">
              <span className="font-mono text-sm">{r.owner}/{r.repo}</span>
              <Badge variant="outline" className="text-[10px]">wants {r.requested_role}</Badge>
              {statusBadge(r.status)}
              <span className="text-[11px] text-muted-foreground ml-auto">{new Date(r.created_at).toLocaleString()}</span>
              {r.status === "pending" && (
                <Button size="sm" variant="outline" onClick={() => cancelMut.mutate(r.id)} disabled={cancelMut.isPending}>Cancel</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────── Verification status panel ───────────────── */

function VerificationStatusPanel({
  loading, status, lastError, lastVerify,
}: {
  loading: boolean;
  status: RepoAccessStatus | null;
  lastError: string | null;
  lastVerify: { ok: boolean; role: string; private: boolean; isOrg?: boolean; orgRole?: string | null } | null;
}) {
  if (!loading && !status && !lastError) return null;

  let tone: "loading" | "success" | "warning" | "error" = "loading";
  let title = "Checking…";
  let icon = <Loader2 className="h-4 w-4 animate-spin" />;
  let detail: React.ReactNode = "Querying GitHub and Cortex permissions…";

  if (!loading) {
    if (lastError) {
      tone = "error";
      title = "Verification failed";
      icon = <XCircle className="h-4 w-4" />;
      detail = lastError;
    } else if (lastVerify?.ok) {
      tone = "success";
      title = `Verified · granted ${lastVerify.role}`;
      icon = <CheckCircle2 className="h-4 w-4" />;
      detail = `${lastVerify.private ? "Private" : "Public"} repo${lastVerify.isOrg ? ` · org${lastVerify.orgRole ? ` (${lastVerify.orgRole})` : ""}` : ""}.`;
    } else if (status?.appHasAccess) {
      tone = "success";
      title = `Access confirmed · ${status.appRole}`;
      icon = <ShieldCheck className="h-4 w-4" />;
      detail = `You already have ${status.appRole} access in Cortex.`;
    } else if (status) {
      tone = status.tokenCanRead ? "warning" : "warning";
      title = status.tokenCanRead ? "Visible on GitHub · no Cortex access" : "Not visible to current token";
      icon = <AlertTriangle className="h-4 w-4" />;
      detail = status.reason ?? (status.tokenCanRead
        ? "You can see this repo on GitHub but haven't been granted access in Cortex yet. Verify with your token or request access below."
        : "Connect a GitHub token with the correct scope, or request access from a Cortex admin.");
    }
  }

  const cls =
    tone === "success" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
    : tone === "warning" ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
    : tone === "error" ? "border-rose-500/30 bg-rose-500/5 text-rose-300"
    : "border-border/60 bg-muted/30 text-muted-foreground";

  const checkedAt = status?.checkedAt ?? null;

  return (
    <div className={`rounded-lg border p-3 flex items-start gap-3 ${cls}`}>
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs opacity-90 break-words">{detail}</p>
        {checkedAt && (
          <p className="text-[11px] opacity-70">
            Last checked {new Date(checkedAt).toLocaleString()}
            {status?.usedUserToken ? " · using your connected GitHub token" : " · using shared token"}
          </p>
        )}
      </div>
    </div>
  );
}

/* ───────────────── Audit log panel ───────────────── */

const ACTION_LABEL: Record<string, string> = {
  detect_repo_access: "Checked access",
  verify_github_access: "Verified via GitHub",
  claim_owner: "Claimed ownership",
  approve_request: "Approved request",
  reject_request: "Rejected request",
  revoke_permission: "Revoked permission",
  connect_github_token: "Connected GitHub token",
  disconnect_github_token: "Disconnected GitHub token",
};

function AuditPanel() {
  const list = useServerFn(listMyAuditLogs);
  const q = useQuery({
    queryKey: ["myAuditLogs"],
    queryFn: () => list({ data: { limit: 100 } }),
  });

  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  const logs = q.data?.logs ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><ScrollText className="h-4 w-4" /> Audit log</CardTitle>
        <CardDescription>Every access check, claim, grant, and revocation involving you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {logs.length === 0 && (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        )}
        {logs.map((l) => {
          const d = (l.details ?? {}) as Record<string, unknown>;
          const ok = d.ok !== false && l.action !== "reject_request" && l.action !== "revoke_permission";
          return (
            <div key={l.id} className="flex items-start gap-3 rounded-md border border-border/60 p-3 bg-muted/20">
              <div className="mt-0.5">
                {ok
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  : <XCircle className="h-4 w-4 text-rose-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{ACTION_LABEL[l.action] ?? l.action}</span>
                  <span className="font-mono text-xs text-muted-foreground">{l.owner}/{l.repo}</span>
                  {typeof d.role === "string" && <Badge variant="outline" className="text-[10px]">{d.role}</Badge>}
                  {d.private === true && <Badge variant="outline" className="text-[10px]"><Lock className="h-3 w-3 mr-1" />private</Badge>}
                  {d.isOrg === true && <Badge variant="outline" className="text-[10px]">org</Badge>}
                </div>
                {typeof d.reason === "string" && d.reason && (
                  <p className="text-xs text-muted-foreground mt-1 break-words">{d.reason}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {new Date(l.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}