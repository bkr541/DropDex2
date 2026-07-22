-- ============================================================
-- DropDex: repair Rekordbox import writes after schema drift
--
-- Some deployed projects recorded the July migrations incompletely or kept a
-- stale PostgREST schema cache. The backend then sent the metadata-fidelity
-- payload to /rest/v1/rekordbox_tracks and PostgREST rejected it with HTTP 400.
--
-- This migration is intentionally idempotent. It restores the columns required
-- by the current importer, recreates the stale-job RPC used at backend startup,
-- and explicitly reloads the PostgREST schema cache.
-- ============================================================

begin;

-- ── Rekordbox metadata-fidelity columns required by _insert_tracks ───────────
alter table public.rekordbox_tracks
  -- Normalized-key columns are part of the same insert payload. Some remote
  -- projects skipped the June key migration as well as the July migrations.
  add column if not exists camelot_key           text,
  add column if not exists normalized_key_name   text,
  add column if not exists key_tonic             text,
  add column if not exists key_mode              text,
  -- Device Library Plus analysis identity columns are also written during the
  -- first track insert, before any ANLZ files are uploaded.
  add column if not exists master_db_id                   text,
  add column if not exists master_content_id              text,
  add column if not exists analysis_data_file_path        text,
  add column if not exists analysed_bits                  bigint,
  add column if not exists cue_update_count               bigint,
  add column if not exists analysis_data_update_count     bigint,
  add column if not exists information_update_count       bigint,
  add column if not exists source_title          text,
  add column if not exists subtitle              text,
  add column if not exists original_artist       text,
  add column if not exists composer              text,
  add column if not exists lyricist               text,
  add column if not exists duration_ms           bigint,
  add column if not exists track_number          integer,
  add column if not exists disc_number           integer,
  add column if not exists release_year          integer,
  add column if not exists release_date          timestamptz,
  add column if not exists color_name            text,
  add column if not exists artwork_path          text,
  add column if not exists file_name             text,
  add column if not exists file_size_bytes       bigint,
  add column if not exists file_type_code        integer,
  add column if not exists file_extension        text,
  add column if not exists bitrate_kbps          integer,
  add column if not exists bit_depth             integer,
  add column if not exists sample_rate_hz        integer,
  add column if not exists isrc                  text,
  add column if not exists hot_cue_auto_load     boolean,
  add column if not exists file_path_normalized  text,
  add column if not exists file_path_volume      text,
  add column if not exists file_path_casefold    text,
  add column if not exists source_metadata       jsonb not null default '{}'::jsonb;

update public.rekordbox_tracks
set source_title = title
where source_title is null
  and title <> '(untitled)';

update public.rekordbox_tracks
set duration_ms = duration_seconds::bigint * 1000
where duration_ms is null
  and duration_seconds is not null;

create index if not exists rekordbox_tracks_import_path_casefold_idx
  on public.rekordbox_tracks (import_id, file_path_casefold)
  where file_path_casefold is not null;

create index if not exists rekordbox_tracks_import_isrc_idx
  on public.rekordbox_tracks (import_id, isrc)
  where isrc is not null;

create index if not exists rekordbox_tracks_import_file_type_idx
  on public.rekordbox_tracks (import_id, file_type_code)
  where file_type_code is not null;

-- Recreate the import-critical checks when a partially applied migration left
-- the columns in place without the constraints.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_tracks_duration_ms_check'
      and conrelid = 'public.rekordbox_tracks'::regclass
  ) then
    alter table public.rekordbox_tracks
      add constraint rekordbox_tracks_duration_ms_check
      check (duration_ms is null or duration_ms >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_tracks_rating_range_check'
      and conrelid = 'public.rekordbox_tracks'::regclass
  ) then
    alter table public.rekordbox_tracks
      add constraint rekordbox_tracks_rating_range_check
      check (rating is null or rating between 0 and 5) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_tracks_file_size_check'
      and conrelid = 'public.rekordbox_tracks'::regclass
  ) then
    alter table public.rekordbox_tracks
      add constraint rekordbox_tracks_file_size_check
      check (file_size_bytes is null or file_size_bytes >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_tracks_audio_properties_check'
      and conrelid = 'public.rekordbox_tracks'::regclass
  ) then
    alter table public.rekordbox_tracks
      add constraint rekordbox_tracks_audio_properties_check
      check (
        (bitrate_kbps is null or bitrate_kbps >= 0)
        and (bit_depth is null or bit_depth >= 0)
        and (sample_rate_hz is null or sample_rate_hz >= 0)
      ) not valid;
  end if;
end $$;

-- ── Reliability columns and RPC used by the running backend ─────────────────
alter table public.rekordbox_imports
  add column if not exists source_bundle_type text,
  add column if not exists analysis_status text,
  add column if not exists analysis_expected_track_count integer not null default 0,
  add column if not exists analysis_matched_track_count integer not null default 0,
  add column if not exists analysis_parsed_track_count integer not null default 0,
  add column if not exists analysis_failed_track_count integer not null default 0,
  add column if not exists analysis_asset_count integer not null default 0,
  add column if not exists analysis_parser_version text,
  add column if not exists analysis_completed_at timestamptz,
  add column if not exists analysis_warnings jsonb not null default '[]'::jsonb,
  add column if not exists analysis_progress_processed_track_count integer not null default 0,
  add column if not exists analysis_progress_total_track_count integer not null default 0,
  add column if not exists analysis_current_track_id uuid,
  add column if not exists analysis_current_track_title text,
  add column if not exists analysis_current_track_artist text,
  add column if not exists analysis_current_track_label text,
  add column if not exists analysis_progress_updated_at timestamptz;

-- Discovery is optional for Rekordbox imports. Guard this repair so a project
-- without the discovery schema does not roll back all track-column repairs.
do $$
begin
  if to_regclass('public.scrape_jobs') is not null then
    execute 'alter table public.scrape_jobs add column if not exists heartbeat_at timestamptz';
    execute 'alter table public.scrape_jobs add column if not exists updated_at timestamptz not null default now()';
  end if;
end $$;

create or replace function public.recover_stale_discovery_jobs(
  p_stale_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  recovered_count integer := 0;
begin
  if to_regclass('public.scrape_jobs') is null then
    return 0;
  end if;

  execute $update$
    update public.scrape_jobs
    set status = 'failed',
        error_message = 'The scrape stopped because the DropDex service restarted. Please retry.',
        completed_at = now(),
        heartbeat_at = now(),
        updated_at = now()
    where status in ('queued', 'running')
      and coalesce(heartbeat_at, started_at, created_at) < $1
  $update$ using p_stale_before;

  get diagnostics recovered_count = row_count;
  return recovered_count;
end;
$$;

revoke all on function public.recover_stale_discovery_jobs(timestamptz) from public;
grant execute on function public.recover_stale_discovery_jobs(timestamptz) to service_role;

-- DDL is normally picked up automatically, but an explicit notification repairs
-- projects whose PostgREST cache still reports missing columns/functions.
notify pgrst, 'reload schema';

commit;
