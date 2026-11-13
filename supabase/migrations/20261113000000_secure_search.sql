ALTER FUNCTION public.search_repo_chunks(TEXT,TEXT,TEXT,TEXT,INT) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.search_repo_chunks(TEXT,TEXT,TEXT,TEXT,INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_repo_chunks(TEXT,TEXT,TEXT,TEXT,INT) TO authenticated, service_role;
ALTER TABLE public.workspace_files ADD COLUMN gh_blob_sha text;
