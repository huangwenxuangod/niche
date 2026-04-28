create table if not exists wxvideo_sources (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references journeys(id) on delete cascade,
  linked_koc_source_id uuid references koc_sources(id) on delete set null,
  platform text not null default 'wechat_channels',
  v2_name text not null,
  account_name text,
  signature text,
  ext_info jsonb,
  avatar_url text,
  feed_count integer default 0,
  original_count integer default 0,
  max_like_count integer default 0,
  avg_like_count integer default 0,
  last_buffer text,
  last_fetched_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (journey_id, v2_name)
);

create table if not exists wxvideo_posts (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references journeys(id) on delete cascade,
  wxvideo_source_id uuid not null references wxvideo_sources(id) on delete cascade,
  object_id text not null,
  export_id text,
  object_nonce_id text,
  media_type text,
  title text,
  cover_url text,
  thumb_url text,
  download_url text,
  decode_key text,
  publish_time timestamptz,
  file_size bigint,
  video_play_len integer,
  fav_count integer default 0,
  like_count integer default 0,
  forward_count integer default 0,
  comment_count integer default 0,
  is_live boolean default false,
  source_type text default 'bound_wechat_account',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (journey_id, object_id)
);

create index if not exists idx_wxvideo_sources_journey_id
  on wxvideo_sources(journey_id);

create index if not exists idx_wxvideo_sources_linked_koc
  on wxvideo_sources(linked_koc_source_id);

create index if not exists idx_wxvideo_posts_journey_id
  on wxvideo_posts(journey_id);

create index if not exists idx_wxvideo_posts_source_id
  on wxvideo_posts(wxvideo_source_id);

alter table wxvideo_sources enable row level security;
alter table wxvideo_posts enable row level security;

create policy "wxvideo_sources_own" on wxvideo_sources for all using (
  journey_id in (select id from journeys where user_id = auth.uid())
);

create policy "wxvideo_posts_own" on wxvideo_posts for all using (
  journey_id in (select id from journeys where user_id = auth.uid())
);
