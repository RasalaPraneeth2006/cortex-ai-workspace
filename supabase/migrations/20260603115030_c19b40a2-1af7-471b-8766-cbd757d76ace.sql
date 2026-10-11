-- Add encrypted token storage + verification telemetry
ALTER TABLE public.user_github_tokens
  ADD COLUMN IF NOT EXISTS token_encrypted text,
  ADD COLUMN IF NOT EXISTS gh_user_id text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verified_status text,
  ADD COLUMN IF NOT EXISTS last_verified_reason text;

-- Clear any pre-existing plaintext tokens; users will reconnect under encryption
UPDATE public.user_github_tokens SET token = '', token_encrypted = NULL WHERE token_encrypted IS NULL;

-- Make plaintext column nullable (kept for transition; new writes go to token_encrypted)
ALTER TABLE public.user_github_tokens ALTER COLUMN token DROP NOT NULL;