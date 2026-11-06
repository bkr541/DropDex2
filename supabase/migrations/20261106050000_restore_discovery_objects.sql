-- ============================================================
-- DropDex: restore the discovery objects that 20260721020000 was meant to create
--
-- The live database recorded 20260721020000_user_facing_reliability as applied, but these four pieces are missing
-- (that file was edited after it was first applied), so artist pages failed with "A database error occurred":
--   * public.scrape_job_subscribers          (starting or polling a scrape needs it)
--   * scrape_jobs_one_active_artist_source_uidx (one active scrape per artist)
--   * public.get_discovery_artist_counts
--   * public.get_discovery_artist_setlists_page (the artist page's setlists)
-- Everything here is idempotent, so it is safe on a database that already has them.
-- ============================================================

begin;

-- Existing deployments may already contain duplicate active jobs. Keep the
-- newest one active and fail older duplicates before creating the unique index.
with ranked_active as (
  select id,
         row_number() over (
           partition by artist_id, job_type, source
           order by created_at desc, id desc
         ) as row_rank
  from public.scrape_jobs
  where status in ('queued', 'running')
)
update public.scrape_jobs as jobs
set status = 'failed',
    error_message = 'A newer scrape replaced this duplicate job.',
    completed_at = now(),
    heartbeat_at = now(),
    updated_at = now()
from ranked_active
where jobs.id = ranked_active.id
  and ranked_active.row_rank > 1;

create unique index if not exists scrape_jobs_one_active_artist_source_uidx
  on public.scrape_jobs (artist_id, job_type, source)
  where status in ('queued', 'running');

create table if not exists public.scrape_job_subscribers (
  job_id uuid not null references public.scrape_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscribed_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

create index if not exists scrape_job_subscribers_user_idx
  on public.scrape_job_subscribers (user_id, subscribed_at desc);

alter table public.scrape_job_subscribers enable row level security;

create or replace function public.get_discovery_artist_counts(
  p_artist_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'setlist_count', count(distinct links.set_result_id),
    'track_count', count(tracks.id)
  )
  from public.artist_set_result_artists as links
  left join public.artist_set_tracks as tracks
    on tracks.set_result_id = links.set_result_id
  where links.artist_id = p_artist_id;
$$;

create or replace function public.get_discovery_artist_setlists_page(
  p_artist_id uuid,
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select results.*
    from public.artist_set_result_artists as links
    join public.artist_set_results as results
      on results.id = links.set_result_id
    where links.artist_id = p_artist_id
  ),
  page as (
    select base.*
    from base
    order by base.set_date desc nulls last,
             base.updated_at desc nulls last,
             base.id asc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb),
    'total', (select count(*) from base),
    'offset', greatest(coalesce(p_offset, 0), 0),
    'limit', least(greatest(coalesce(p_limit, 20), 1), 100)
  );
$$;


revoke all on function public.get_discovery_artist_counts(uuid) from public;
revoke all on function public.get_discovery_artist_setlists_page(uuid, integer, integer) from public;
grant execute on function public.get_discovery_artist_counts(uuid) to authenticated, service_role;
grant execute on function public.get_discovery_artist_setlists_page(uuid, integer, integer) to authenticated, service_role;

-- ── Similar Vibes: direct, half-time, and double-time candidates ─────────────

commit;
