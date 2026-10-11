
-- 1. Jobs: add user_id, restrict policies
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE INDEX IF NOT EXISTS jobs_user_id_idx ON public.jobs(user_id);

DROP POLICY IF EXISTS "jobs read all" ON public.jobs;
DROP POLICY IF EXISTS "jobs write all" ON public.jobs;

CREATE POLICY "jobs read own" ON public.jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- writes go through service role (supabaseAdmin); no public/auth write policies

-- 2. workspace_files: scope reads + updates to creator
DROP POLICY IF EXISTS "workspace read all" ON public.workspace_files;
DROP POLICY IF EXISTS "workspace update auth" ON public.workspace_files;

CREATE POLICY "workspace read own" ON public.workspace_files
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "workspace update own" ON public.workspace_files
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- 3. repo_chunks: scope reads to users with active repo access
DROP POLICY IF EXISTS "repo_chunks read auth" ON public.repo_chunks;

CREATE POLICY "repo_chunks read access" ON public.repo_chunks
  FOR SELECT TO authenticated
  USING (public.has_active_repo_access(auth.uid(), owner, repo));

-- 4. repository_collaborators: tighten self-claim
DROP POLICY IF EXISTS "collab self-claim owner" ON public.repository_collaborators;

CREATE POLICY "collab self-claim owner" ON public.repository_collaborators
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      (
        role = 'owner'::repo_role
        AND NOT EXISTS (
          SELECT 1 FROM public.repository_collaborators c
          WHERE c.owner = repository_collaborators.owner AND c.repo = repository_collaborators.repo
        )
      )
      OR public.has_repo_role(auth.uid(), owner, repo, ARRAY['owner'::repo_role, 'admin'::repo_role])
    )
  );

-- 5. Remove sensitive tables from realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.repository_permissions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.repository_access_requests;
