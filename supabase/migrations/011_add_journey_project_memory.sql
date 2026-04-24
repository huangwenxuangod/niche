create table if not exists public.journey_project_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  journey_id uuid not null references public.journeys(id) on delete cascade,
  project_card jsonb not null default '{}'::jsonb,
  strategy_state jsonb not null default '{}'::jsonb,
  recent_summaries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (journey_id)
);

alter table public.journey_project_memories enable row level security;

create policy "Users can view their own journey project memories"
on public.journey_project_memories
for select
using (auth.uid() = user_id);

create policy "Users can insert their own journey project memories"
on public.journey_project_memories
for insert
with check (auth.uid() = user_id);

create policy "Users can update their own journey project memories"
on public.journey_project_memories
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
