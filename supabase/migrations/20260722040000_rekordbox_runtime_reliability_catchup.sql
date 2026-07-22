-- ============================================================
-- DropDex: Rekordbox runtime reliability catch-up
--
-- Safe to run after the July 22 convergence/runtime migrations. This file
-- restores the two user-facing RPCs that older projects may have skipped,
-- repairs abandoned historical import states, and keeps import heartbeats fresh.
-- ============================================================

begin;

alter table public.rekordbox_tracks
  add column if not exists camelot_key text;

alter table public.rekordbox_imports
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists analysis_status text,
  add column if not exists analysis_expected_track_count integer not null default 0,
  add column if not exists analysis_parsed_track_count integer not null default 0,
  add column if not exists analysis_failed_track_count integer not null default 0,
  add column if not exists analysis_completed_at timestamptz,
  add column if not exists analysis_progress_processed_track_count integer not null default 0,
  add column if not exists analysis_progress_total_track_count integer not null default 0,
  add column if not exists analysis_current_track_id uuid,
  add column if not exists analysis_current_track_title text,
  add column if not exists analysis_current_track_artist text,
  add column if not exists analysis_current_track_label text,
  add column if not exists analysis_progress_updated_at timestamptz,
  add column if not exists error_code text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists retryable boolean not null default false;

-- A completed metadata snapshot can legitimately run analysis later. If that
-- analysis stopped reporting for an hour, terminate the subordinate state while
-- preserving the usable metadata snapshot.
update public.rekordbox_imports
set analysis_status = case
      when coalesce(analysis_expected_track_count, 0) = 0 then 'not_requested'
      when coalesce(analysis_parsed_track_count, 0) >= coalesce(analysis_expected_track_count, 0)
           and coalesce(analysis_failed_track_count, 0) = 0 then 'completed'
      when coalesce(analysis_parsed_track_count, 0) > 0 then 'partial'
      else 'failed'
    end,
    analysis_completed_at = coalesce(analysis_completed_at, now()),
    analysis_current_track_id = null,
    analysis_current_track_title = null,
    analysis_current_track_artist = null,
    analysis_current_track_label = null,
    analysis_progress_updated_at = now(),
    error_code = case
      when coalesce(analysis_parsed_track_count, 0) = 0
           and coalesce(analysis_expected_track_count, 0) > 0
        then 'ANALYSIS_INTERRUPTED'
      else null
    end,
    error_message = case
      when coalesce(analysis_parsed_track_count, 0) = 0
           and coalesce(analysis_expected_track_count, 0) > 0
        then 'Analysis stopped before completion. Resume analysis to continue.'
      else null
    end,
    retryable = (
      coalesce(analysis_parsed_track_count, 0) = 0
      and coalesce(analysis_expected_track_count, 0) > 0
    ),
    updated_at = now()
where status = 'completed'
  and analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing')
  and coalesce(analysis_progress_updated_at, updated_at, imported_at)
      < now() - interval '1 hour';

-- Old non-terminal rows cannot still be running after a full day. Leaving them
-- active causes permanent 0% banners and prevents honest retry/delete behavior.
update public.rekordbox_imports
set status = case when status = 'cancel_requested' then 'cancelled' else 'failed' end,
    analysis_status = case
      when analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing') then 'failed'
      else analysis_status
    end,
    analysis_completed_at = case
      when analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing')
        then coalesce(analysis_completed_at, now())
      else analysis_completed_at
    end,
    analysis_current_track_id = null,
    analysis_current_track_title = null,
    analysis_current_track_artist = null,
    analysis_current_track_label = null,
    analysis_progress_updated_at = now(),
    error_code = case
      when status = 'cancel_requested' then 'IMPORT_CANCELLED'
      else 'IMPORT_INTERRUPTED'
    end,
    error_message = case
      when status = 'cancel_requested' then 'Import was cancelled before completion.'
      else 'Import stopped before completion. Retry the import.'
    end,
    retryable = status <> 'cancel_requested',
    cancelled_at = case
      when status = 'cancel_requested' then coalesce(cancelled_at, now())
      else cancelled_at
    end,
    updated_at = now()
where status in ('created', 'uploading', 'queued', 'processing', 'cancel_requested')
  and coalesce(analysis_progress_updated_at, updated_at, imported_at)
      < now() - interval '24 hours';

create or replace function public.touch_rekordbox_import_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists aa_touch_rekordbox_import_updated_at on public.rekordbox_imports;
create trigger aa_touch_rekordbox_import_updated_at
before update on public.rekordbox_imports
for each row execute function public.touch_rekordbox_import_updated_at();

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
  'Returns deterministic harmonic/direct/half-time/double-time Similar Vibes candidates.';

revoke all on function public.get_rekordbox_similar_vibe_candidates(
  uuid, uuid, text[], numeric, numeric, text, text, integer
) from public;
grant execute on function public.get_rekordbox_similar_vibe_candidates(
  uuid, uuid, text[], numeric, numeric, text, text, integer
) to authenticated;

notify pgrst, 'reload schema';

commit;
