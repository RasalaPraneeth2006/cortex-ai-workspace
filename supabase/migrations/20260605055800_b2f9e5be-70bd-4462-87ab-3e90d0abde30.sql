
CREATE TABLE public.github_user_identities (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gh_user_id BIGINT NOT NULL,
  gh_login TEXT NOT NULL,
  oauth_access_token_enc TEXT NOT NULL,
  oauth_refresh_token_enc TEXT,
  oauth_expires_at TIMESTAMPTZ,
  oauth_refresh_expires_at TIMESTAMPTZ,
  scopes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.github_user_identities TO authenticated;
GRANT ALL ON public.github_user_identities TO service_role;
ALTER TABLE public.github_user_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own gh identity"
  ON public.github_user_identities FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE TRIGGER touch_github_user_identities BEFORE UPDATE ON public.github_user_identities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.github_app_installations (
  id BIGINT PRIMARY KEY,
  account_login TEXT NOT NULL,
  account_id BIGINT NOT NULL,
  account_type TEXT NOT NULL,
  target_type TEXT,
  repository_selection TEXT NOT NULL DEFAULT 'selected',
  account_avatar_url TEXT,
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.github_app_installations TO authenticated;
GRANT ALL ON public.github_app_installations TO service_role;
ALTER TABLE public.github_app_installations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_gh_app_installations_account_login ON public.github_app_installations(lower(account_login));
CREATE TRIGGER touch_github_app_installations BEFORE UPDATE ON public.github_app_installations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.github_installation_users (
  installation_id BIGINT NOT NULL REFERENCES public.github_app_installations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, user_id)
);
GRANT SELECT ON public.github_installation_users TO authenticated;
GRANT ALL ON public.github_installation_users TO service_role;
ALTER TABLE public.github_installation_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own installation links"
  ON public.github_installation_users FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX idx_gh_installation_users_user ON public.github_installation_users(user_id);

CREATE POLICY "Users can read installations they belong to"
  ON public.github_app_installations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.github_installation_users iu
    WHERE iu.installation_id = github_app_installations.id
      AND iu.user_id = auth.uid()
  ));
