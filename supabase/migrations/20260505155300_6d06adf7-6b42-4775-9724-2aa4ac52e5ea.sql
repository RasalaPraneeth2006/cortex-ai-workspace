create table public.gh_repo_cache (
  id text primary key,
  owner text not null,
  repo text not null,
  ref text not null,
  default_branch text not null,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
create table public.gh_file_cache (
  id text primary key,
  owner text not null,
  repo text not null,
  ref text not null,
  path text not null,
  content text not null,
  truncated boolean not null default false,
  fetched_at timestamptz not null default now()
);
create table public.ai_explain_cache (
  id text primary key,
  path text not null,
  language text,
  content_hash text not null,
  explanation text not null,
  created_at timestamptz not null default now()
);
create index gh_file_cache_repo_idx on public.gh_file_cache (owner, repo, ref);
create index gh_repo_cache_fetched_idx on public.gh_repo_cache (fetched_at);

alter table public.gh_repo_cache enable row level security;
alter table public.gh_file_cache enable row level security;
alter table public.ai_explain_cache enable row level security;
-- No policies: only the service-role admin client (which bypasses RLS) can access these caches.