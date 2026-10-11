
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TYPE public.repo_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE public.access_request_status AS ENUM ('pending', 'approved', 'rejected', 'revoked', 'expired');

CREATE TABLE public.repository_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  repo text NOT NULL,
  user_id uuid NOT NULL,
  role public.repo_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner, repo, user_id)
);
CREATE INDEX idx_repo_collab_repo ON public.repository_collaborators (owner, repo);
CREATE INDEX idx_repo_collab_user ON public.repository_collaborators (user_id);

CREATE TABLE public.repository_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  repo text NOT NULL,
  user_id uuid NOT NULL,
  role public.repo_role NOT NULL DEFAULT 'viewer',
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (owner, repo, user_id)
);
CREATE INDEX idx_repo_perm_repo ON public.repository_permissions (owner, repo);
CREATE INDEX idx_repo_perm_user ON public.repository_permissions (user_id);

CREATE TABLE public.repository_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  repo text NOT NULL,
  requester_id uuid NOT NULL,
  requested_role public.repo_role NOT NULL DEFAULT 'viewer',
  message text,
  status public.access_request_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_access_req_repo ON public.repository_access_requests (owner, repo, status);
CREATE INDEX idx_access_req_requester ON public.repository_access_requests (requester_id);

CREATE TRIGGER trg_access_req_touch
  BEFORE UPDATE ON public.repository_access_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.access_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  repo text NOT NULL,
  actor_id uuid,
  target_user_id uuid,
  action text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_repo ON public.access_audit_logs (owner, repo, created_at DESC);

CREATE OR REPLACE FUNCTION public.has_repo_role(_user uuid, _owner text, _repo text, _roles public.repo_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.repository_collaborators
    WHERE user_id = _user AND owner = _owner AND repo = _repo AND role = ANY(_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.has_active_repo_access(_user uuid, _owner text, _repo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.repository_collaborators
      WHERE user_id = _user AND owner = _owner AND repo = _repo
    )
    OR EXISTS (
      SELECT 1 FROM public.repository_permissions
      WHERE user_id = _user AND owner = _owner AND repo = _repo
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
    );
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.repository_collaborators TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.repository_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.repository_access_requests TO authenticated;
GRANT SELECT, INSERT ON public.access_audit_logs TO authenticated;
GRANT ALL ON public.repository_collaborators TO service_role;
GRANT ALL ON public.repository_permissions TO service_role;
GRANT ALL ON public.repository_access_requests TO service_role;
GRANT ALL ON public.access_audit_logs TO service_role;

ALTER TABLE public.repository_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repository_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repository_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collab read all" ON public.repository_collaborators
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "collab self-claim owner" ON public.repository_collaborators
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.repository_collaborators c
        WHERE c.owner = repository_collaborators.owner AND c.repo = repository_collaborators.repo
      )
      OR public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[])
    )
  );

CREATE POLICY "collab update by owner/admin" ON public.repository_collaborators
  FOR UPDATE TO authenticated
  USING (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[]))
  WITH CHECK (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[]));

CREATE POLICY "collab delete by owner" ON public.repository_collaborators
  FOR DELETE TO authenticated
  USING (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner']::public.repo_role[]));

CREATE POLICY "perm read self or admin" ON public.repository_permissions
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[])
  );

CREATE POLICY "perm insert by owner/admin" ON public.repository_permissions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[]));

CREATE POLICY "perm update by owner/admin" ON public.repository_permissions
  FOR UPDATE TO authenticated
  USING (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[]))
  WITH CHECK (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[]));

CREATE POLICY "perm delete by owner/admin" ON public.repository_permissions
  FOR DELETE TO authenticated
  USING (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[]));

CREATE POLICY "req read self or admin" ON public.repository_access_requests
  FOR SELECT TO authenticated
  USING (
    auth.uid() = requester_id
    OR public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[])
  );

CREATE POLICY "req insert self" ON public.repository_access_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "req update by admin or requester-cancel" ON public.repository_access_requests
  FOR UPDATE TO authenticated
  USING (
    public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[])
    OR (auth.uid() = requester_id AND status = 'pending')
  )
  WITH CHECK (
    public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[])
    OR (auth.uid() = requester_id)
  );

CREATE POLICY "audit read by admin" ON public.access_audit_logs
  FOR SELECT TO authenticated
  USING (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[]));

CREATE POLICY "audit insert by admin" ON public.access_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner','admin']::public.repo_role[]));

ALTER PUBLICATION supabase_realtime ADD TABLE public.repository_access_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.repository_permissions;
