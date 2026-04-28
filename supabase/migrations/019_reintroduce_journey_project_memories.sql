-- 重新引入旅程级项目记忆
-- 作为“项目策略卡片”的唯一真相源，与 user_memories 分层

create table if not exists public.journey_project_memories (
  journey_id uuid primary key references public.journeys(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists idx_journey_project_memories_journey_id
  on public.journey_project_memories(journey_id);

alter table public.journey_project_memories enable row level security;

create policy "journey_project_memories_own"
on public.journey_project_memories
for all
using (
  exists (
    select 1
    from public.journeys j
    where j.id = journey_project_memories.journey_id
      and j.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.journeys j
    where j.id = journey_project_memories.journey_id
      and j.user_id = auth.uid()
  )
);

comment on table public.journey_project_memories is '项目记忆：记录当前旅程的策略卡片、已验证选题模式和阶段性增长假设。';
