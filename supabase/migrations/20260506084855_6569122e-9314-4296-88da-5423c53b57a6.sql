
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind TEXT NOT NULL,                  -- 'repo_analyze' | 'file_explain'
  target TEXT NOT NULL,                -- e.g. owner/repo@ref or owner/repo@ref:path
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | error | retrying
  progress INT NOT NULL DEFAULT 0,
  message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_target_idx ON public.jobs (target);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON public.jobs (created_at DESC);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs read all" ON public.jobs;
DROP POLICY IF EXISTS "jobs write all" ON public.jobs;
CREATE POLICY "jobs read all" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "jobs write all" ON public.jobs FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS jobs_touch ON public.jobs;
CREATE TRIGGER jobs_touch BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_jobs_updated_at();

ALTER TABLE public.jobs REPLICA IDENTITY FULL;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='jobs';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs';
  END IF;
END $$;
