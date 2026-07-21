-- ============================================================
-- DropDex: user-facing reliability and large-library safeguards
--
-- 1. Durable import progress shared across workers/restarts.
-- 2. One active discovery scrape per artist, with subscribers and stale recovery.
-- 3. Server-side paginated discovery/catalog queries.
-- 4. Ownership-safe playlist membership lookup.
-- 5. Similar Vibes half-time/double-time candidate retrieval and ranking.
-- ============================================================

begin;

-- ── Persistent analysis progress ─────────────────────────────────────────────
alter table public.rekordbox_imports
  add column if not exists analysis_progress_processed_track_count integer not null default 0,
  add column if not exists analysis_progress_total_track_count integer not null default 0,
  add column if not exists analysis_current_track_id uuid,
  add column if not exists analysis_current_track_title text,
  add column if not exists analysis_current_track_artist text,
  add column if not exists analysis_current_track_label text,
  add column if not exists analysis_progress_updated_at timestamptz;

-- ── Discovery job deduplication / recovery ───────────────────────────────────
alter table public.scrape_jobs
  add column if not exists heartbeat_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

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

create index if not exists scrape_jobs_active_heartbeat_idx
  on public.scrape_jobs (heartbeat_at)
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

create or replace function public.recover_stale_discovery_jobs(
  p_stale_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  recovered_count integer;
begin
  update public.scrape_jobs
  set status = 'failed',
      error_message = 'The scrape stopped because the DropDex service restarted. Please retry.',
      completed_at = now(),
      heartbeat_at = now(),
      updated_at = now()
  where status in ('queued', 'running')
    and coalesce(heartbeat_at, started_at, created_at) < p_stale_before;

  get diagnostics recovered_count = row_count;
  return recovered_count;
end;
$$;

revoke all on function public.recover_stale_discovery_jobs(timestamptz) from public;
grant execute on function public.recover_stale_discovery_jobs(timestamptz) to service_role;

-- ── Server-side large-library/catalog queries ─────────────────────────────────
create or replace function public.get_rekordbox_track_playlists(
  p_import_id uuid,
  p_track_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'position', placements.position,
      'playlist', to_jsonb(playlists)
    ) order by lower(playlists.name), placements.position
  ), '[]'::jsonb)
  from public.rekordbox_playlist_tracks as placements
  join public.rekordbox_playlists as playlists
    on playlists.id = placements.playlist_id
  join public.rekordbox_imports as imports
    on imports.id = playlists.import_id
  where placements.track_id = p_track_id
    and playlists.import_id = p_import_id
    and imports.user_id = auth.uid();
$$;

revoke all on function public.get_rekordbox_track_playlists(uuid, uuid) from public;
grant execute on function public.get_rekordbox_track_playlists(uuid, uuid) to authenticated;

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
create or replace function public.get_rekordbox_similar_vibe_candidates(
  p_import_id uuid,
  p_selected_track_id uuid,
  p_compatible_camelot_keys text[] default array[]::text[],
  p_selected_bpm numeric default null,
  p_bpm_tolerance numeric default 2,
  p_selected_genre text default null,
  p_selected_label text default null,
  p_limit integer default 100
)
returns setof public.rekordbox_tracks
language sql
stable
security invoker
set search_path = public
as $$
  with candidate_scores as (
    select t as track_row,
      least(
        abs(t.bpm - p_selected_bpm),
        abs((t.bpm * 2) - p_selected_bpm),
        abs((t.bpm / 2) - p_selected_bpm)
      ) as normalized_bpm_diff,
      case
        when abs(t.bpm - p_selected_bpm) <= greatest(coalesce(p_bpm_tolerance, 0), 0)
          then 1::numeric
        when abs((t.bpm * 2) - p_selected_bpm) <= greatest(coalesce(p_bpm_tolerance, 0), 0)
          then 0.8::numeric
        when abs((t.bpm / 2) - p_selected_bpm) <= greatest(coalesce(p_bpm_tolerance, 0), 0)
          then 0.8::numeric
        else 0::numeric
      end as tempo_weight
    from public.rekordbox_tracks as t
    where t.import_id = p_import_id
      and t.id <> p_selected_track_id
      and (
        (
          cardinality(coalesce(p_compatible_camelot_keys, array[]::text[])) > 0
          and t.camelot_key = any(coalesce(p_compatible_camelot_keys, array[]::text[]))
        )
        or (
          p_selected_bpm is not null
          and p_selected_bpm > 0
          and t.bpm is not null
          and t.bpm > 0
          and least(
            abs(t.bpm - p_selected_bpm),
            abs((t.bpm * 2) - p_selected_bpm),
            abs((t.bpm / 2) - p_selected_bpm)
          ) <= greatest(coalesce(p_bpm_tolerance, 0), 0)
        )
      )
  )
  select (candidate_scores.track_row).*
  from candidate_scores
  order by
    (
      case array_position(
        coalesce(p_compatible_camelot_keys, array[]::text[]),
        (candidate_scores.track_row).camelot_key
      )
        when 1 then 30::numeric
        when 2 then 25::numeric
        when 3 then 20::numeric
        when 4 then 20::numeric
        when 5 then 12::numeric
        else 0::numeric
      end
      + case
          when p_selected_bpm is not null
            and p_selected_bpm > 0
            and (candidate_scores.track_row).bpm is not null
            and (candidate_scores.track_row).bpm > 0
            and coalesce(p_bpm_tolerance, 0) > 0
            and normalized_bpm_diff <= p_bpm_tolerance
          then 10::numeric * tempo_weight * (
            1::numeric - normalized_bpm_diff / p_bpm_tolerance
          )
          when p_selected_bpm is not null
            and p_selected_bpm > 0
            and normalized_bpm_diff = 0
          then 10::numeric * tempo_weight
          else 0::numeric
        end
      + case
          when nullif(btrim(p_selected_genre), '') is not null
            and lower(btrim((candidate_scores.track_row).genre)) = lower(btrim(p_selected_genre))
          then 5::numeric else 0::numeric
        end
      + case
          when nullif(btrim(p_selected_label), '') is not null
            and lower(btrim((candidate_scores.track_row).label)) = lower(btrim(p_selected_label))
          then 3::numeric else 0::numeric
        end
    ) desc,
    normalized_bpm_diff asc nulls last,
    lower((candidate_scores.track_row).title) asc,
    (candidate_scores.track_row).id asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

comment on function public.get_rekordbox_similar_vibe_candidates(
  uuid, uuid, text[], numeric, numeric, text, text, integer
) is
  'Returns deterministic harmonic/direct/half-time/double-time Similar Vibes candidates before applying the limit.';

revoke all on function public.get_rekordbox_similar_vibe_candidates(
  uuid, uuid, text[], numeric, numeric, text, text, integer
) from public;
grant execute on function public.get_rekordbox_similar_vibe_candidates(
  uuid, uuid, text[], numeric, numeric, text, text, integer
) to authenticated;

commit;
