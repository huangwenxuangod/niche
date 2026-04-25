create extension if not exists vector with schema extensions;

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  source_type text not null,
  source_table text not null,
  source_id uuid not null,
  account_name text,
  article_title text,
  publish_time timestamptz,
  read_count integer,
  chunk_index integer not null,
  chunk_text text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1024) not null,
  embedding_model text not null default 'doubao-embedding-vision-251215',
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_source_type_check;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_source_type_check
  check (source_type in ('competitor_account', 'wechat_hot_discovery', 'owned_account'));

create unique index if not exists idx_knowledge_chunks_source_unique
  on public.knowledge_chunks(source_table, source_id, chunk_index, embedding_model);

create index if not exists idx_knowledge_chunks_journey_id
  on public.knowledge_chunks(journey_id);

create index if not exists idx_knowledge_chunks_source_type
  on public.knowledge_chunks(source_type);

create index if not exists idx_knowledge_chunks_account_name
  on public.knowledge_chunks(account_name);

create index if not exists idx_knowledge_chunks_metadata
  on public.knowledge_chunks using gin(metadata jsonb_path_ops);

create index if not exists idx_knowledge_chunks_embedding_hnsw
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_knowledge_chunks(
  query_embedding vector(1024),
  match_count integer default 8,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  journey_id uuid,
  source_type text,
  source_table text,
  source_id uuid,
  account_name text,
  article_title text,
  publish_time timestamptz,
  read_count integer,
  chunk_index integer,
  chunk_text text,
  metadata jsonb,
  embedding_model text,
  similarity double precision
)
language sql
stable
as $$
  select
    kc.id,
    kc.journey_id,
    kc.source_type,
    kc.source_table,
    kc.source_id,
    kc.account_name,
    kc.article_title,
    kc.publish_time,
    kc.read_count,
    kc.chunk_index,
    kc.chunk_text,
    kc.metadata,
    kc.embedding_model,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where kc.metadata @> filter
  order by kc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

alter table public.knowledge_chunks enable row level security;

drop policy if exists knowledge_chunks_select_own_journey on public.knowledge_chunks;
create policy knowledge_chunks_select_own_journey
  on public.knowledge_chunks
  for select
  using (
    exists (
      select 1
      from public.journeys j
      where j.id = knowledge_chunks.journey_id
        and j.user_id = auth.uid()
    )
  );

drop policy if exists knowledge_chunks_insert_own_journey on public.knowledge_chunks;
create policy knowledge_chunks_insert_own_journey
  on public.knowledge_chunks
  for insert
  with check (
    exists (
      select 1
      from public.journeys j
      where j.id = knowledge_chunks.journey_id
        and j.user_id = auth.uid()
    )
  );

drop policy if exists knowledge_chunks_update_own_journey on public.knowledge_chunks;
create policy knowledge_chunks_update_own_journey
  on public.knowledge_chunks
  for update
  using (
    exists (
      select 1
      from public.journeys j
      where j.id = knowledge_chunks.journey_id
        and j.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.journeys j
      where j.id = knowledge_chunks.journey_id
        and j.user_id = auth.uid()
    )
  );

drop policy if exists knowledge_chunks_delete_own_journey on public.knowledge_chunks;
create policy knowledge_chunks_delete_own_journey
  on public.knowledge_chunks
  for delete
  using (
    exists (
      select 1
      from public.journeys j
      where j.id = knowledge_chunks.journey_id
        and j.user_id = auth.uid()
    )
  );
