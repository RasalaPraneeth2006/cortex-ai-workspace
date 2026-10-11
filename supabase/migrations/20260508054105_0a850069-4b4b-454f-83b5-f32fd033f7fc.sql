
CREATE TABLE IF NOT EXISTS public.repo_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  ref TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT,
  chunk_index INT NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  token_count INT NOT NULL DEFAULT 0,
  tsv TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(path, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner, repo, ref, path, chunk_index)
);

CREATE INDEX IF NOT EXISTS repo_chunks_tsv_idx ON public.repo_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS repo_chunks_repo_idx ON public.repo_chunks (owner, repo, ref);
CREATE INDEX IF NOT EXISTS repo_chunks_path_idx ON public.repo_chunks (owner, repo, ref, path);

ALTER TABLE public.repo_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "repo_chunks read auth"
ON public.repo_chunks FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies => only service role (admin client) can write.

-- RPC: ranked full-text search across chunks for a repo @ ref
CREATE OR REPLACE FUNCTION public.search_repo_chunks(
  _owner TEXT,
  _repo TEXT,
  _ref TEXT,
  _query TEXT,
  _limit INT DEFAULT 8
)
RETURNS TABLE (
  path TEXT,
  language TEXT,
  chunk_index INT,
  content TEXT,
  rank REAL
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.path, c.language, c.chunk_index, c.content,
         ts_rank(c.tsv, websearch_to_tsquery('english', _query)) AS rank
  FROM public.repo_chunks c
  WHERE c.owner = _owner AND c.repo = _repo AND c.ref = _ref
    AND c.tsv @@ websearch_to_tsquery('english', _query)
  ORDER BY rank DESC
  LIMIT greatest(1, least(_limit, 30));
$$;

GRANT EXECUTE ON FUNCTION public.search_repo_chunks(TEXT,TEXT,TEXT,TEXT,INT) TO authenticated, anon;
