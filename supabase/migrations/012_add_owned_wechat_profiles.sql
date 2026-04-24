create table if not exists public.owned_wechat_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  journey_id uuid not null references journeys(id) on delete cascade,
  wechat_config_id uuid references wechat_publish_configs(id) on delete set null,
  account_name text not null,
  import_source text not null default 'dajiala' check (import_source in ('dajiala', 'official', 'mixed')),
  official_sync_enabled boolean not null default false,
  official_metrics_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (journey_id, account_name)
);

alter table public.owned_wechat_articles
  alter column wechat_config_id drop not null;

alter table public.owned_wechat_articles
  add column if not exists owned_profile_id uuid references public.owned_wechat_profiles(id) on delete cascade;

create index if not exists idx_owned_wechat_profiles_journey_id
on public.owned_wechat_profiles(journey_id);

create index if not exists idx_owned_wechat_articles_owned_profile_id
on public.owned_wechat_articles(owned_profile_id);

alter table public.owned_wechat_profiles enable row level security;

create policy "owned_wechat_profiles_own" on public.owned_wechat_profiles
for all using (
  journey_id in (select id from journeys where user_id = auth.uid())
);
