
-- Workspace files: in-app editable files (separate from GitHub repo)
CREATE TABLE public.workspace_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL,
  language text,
  content text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'local', -- 'local' | 'github'
  gh_owner text,
  gh_repo text,
  gh_ref text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (path)
);

ALTER TABLE public.workspace_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace read all" ON public.workspace_files
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "workspace insert auth" ON public.workspace_files
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "workspace update auth" ON public.workspace_files
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "workspace delete owner" ON public.workspace_files
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

CREATE TRIGGER touch_workspace_files
  BEFORE UPDATE ON public.workspace_files
  FOR EACH ROW EXECUTE FUNCTION public.touch_jobs_updated_at();

ALTER TABLE public.workspace_files REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_files;
