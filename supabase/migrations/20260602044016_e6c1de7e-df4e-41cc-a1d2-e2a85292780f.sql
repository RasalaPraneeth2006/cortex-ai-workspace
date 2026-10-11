CREATE TABLE public.user_github_tokens (
  user_id UUID PRIMARY KEY,
  token TEXT NOT NULL,
  gh_login TEXT,
  scopes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_github_tokens TO authenticated;
GRANT ALL ON public.user_github_tokens TO service_role;

ALTER TABLE public.user_github_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gh tokens read own" ON public.user_github_tokens
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "gh tokens insert own" ON public.user_github_tokens
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "gh tokens update own" ON public.user_github_tokens
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "gh tokens delete own" ON public.user_github_tokens
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER touch_user_github_tokens_updated_at
  BEFORE UPDATE ON public.user_github_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();