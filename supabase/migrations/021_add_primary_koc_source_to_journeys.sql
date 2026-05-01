alter table public.journeys
  add column if not exists primary_koc_source_id uuid references public.koc_sources(id) on delete set null;

create index if not exists idx_journeys_primary_koc_source_id
on public.journeys(primary_koc_source_id);
