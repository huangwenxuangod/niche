alter table public.koc_sources
  add column if not exists source_type text not null default 'explicit_benchmark',
  add column if not exists discovery_keyword text,
  add column if not exists discovery_confidence numeric;

alter table public.koc_sources
  drop constraint if exists koc_sources_source_type_check;

alter table public.koc_sources
  add constraint koc_sources_source_type_check
  check (source_type in ('explicit_benchmark', 'hot_article_discovery'));

alter table public.knowledge_articles
  add column if not exists source_type text not null default 'competitor_account',
  add column if not exists discovery_keyword text,
  add column if not exists discovery_reason text;

alter table public.knowledge_articles
  drop constraint if exists knowledge_articles_source_type_check;

alter table public.knowledge_articles
  add constraint knowledge_articles_source_type_check
  check (source_type in ('competitor_account', 'wechat_hot_discovery'));

create index if not exists idx_koc_sources_source_type on public.koc_sources(source_type);
create index if not exists idx_koc_sources_discovery_keyword on public.koc_sources(discovery_keyword);
create index if not exists idx_knowledge_articles_source_type on public.knowledge_articles(source_type);
create index if not exists idx_knowledge_articles_discovery_keyword on public.knowledge_articles(discovery_keyword);
