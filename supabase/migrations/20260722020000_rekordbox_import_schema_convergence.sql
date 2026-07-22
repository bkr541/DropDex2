-- ============================================================
-- DropDex: converge the remote schema required by USB imports
--
-- This migration repairs projects whose migration history skipped one or more
-- Rekordbox migrations. It deliberately repeats the import-critical DDL with
-- IF NOT EXISTS guards so the current writer payload can be accepted even when
-- 20260615000000, 20260616000000, 20260714010000, or
-- 20260721020000 was not actually applied to the remote project.
-- ============================================================

begin;

-- The importer already reached insert_tracks, so these base tables should
-- exist. Fail with an explicit migration name instead of a vague ALTER error
-- if an installation is older than the initial Rekordbox schema.
do $$
begin
  if to_regclass('public.rekordbox_imports') is null
     or to_regclass('public.rekordbox_tracks') is null
     or to_regclass('public.rekordbox_playlists') is null
     or to_regclass('public.rekordbox_playlist_tracks') is null then
    raise exception using
      errcode = '42P01',
      message = 'DropDex base Rekordbox tables are missing',
      hint = 'Apply 20260526120000_rekordbox_schema.sql before this migration.';
  end if;
end $$;

-- ── Columns written while creating/finalizing an import ─────────────────────
alter table public.rekordbox_imports
  add column if not exists source_bundle_type                       text,
  add column if not exists analysis_status                          text,
  add column if not exists analysis_expected_track_count            integer not null default 0,
  add column if not exists analysis_matched_track_count             integer not null default 0,
  add column if not exists analysis_parsed_track_count              integer not null default 0,
  add column if not exists analysis_failed_track_count              integer not null default 0,
  add column if not exists analysis_asset_count                     integer not null default 0,
  add column if not exists analysis_parser_version                  text,
  add column if not exists analysis_completed_at                    timestamptz,
  add column if not exists analysis_warnings                        jsonb not null default '[]'::jsonb,
  add column if not exists analysis_progress_processed_track_count  integer not null default 0,
  add column if not exists analysis_progress_total_track_count      integer not null default 0,
  add column if not exists analysis_current_track_id                uuid,
  add column if not exists analysis_current_track_title             text,
  add column if not exists analysis_current_track_artist            text,
  add column if not exists analysis_current_track_label             text,
  add column if not exists analysis_progress_updated_at             timestamptz;

-- ── Every column currently sent by _insert_tracks ────────────────────────────
alter table public.rekordbox_tracks
  add column if not exists camelot_key                    text,
  add column if not exists normalized_key_name            text,
  add column if not exists key_tonic                      text,
  add column if not exists key_mode                       text,
  add column if not exists master_db_id                   text,
  add column if not exists master_content_id              text,
  add column if not exists analysis_data_file_path        text,
  add column if not exists analysed_bits                  bigint,
  add column if not exists cue_update_count               bigint,
  add column if not exists analysis_data_update_count     bigint,
  add column if not exists information_update_count       bigint,
  add column if not exists analysis_reused_from_track_id  uuid references public.rekordbox_tracks(id) on delete set null,
  add column if not exists analysis_parse_status          text,
  add column if not exists analysis_parse_warnings        jsonb not null default '[]'::jsonb,
  add column if not exists source_title                   text,
  add column if not exists subtitle                       text,
  add column if not exists original_artist                text,
  add column if not exists composer                       text,
  add column if not exists lyricist                       text,
  add column if not exists duration_ms                    bigint,
  add column if not exists track_number                   integer,
  add column if not exists disc_number                    integer,
  add column if not exists release_year                   integer,
  add column if not exists release_date                   timestamptz,
  add column if not exists color_name                     text,
  add column if not exists artwork_path                   text,
  add column if not exists file_name                      text,
  add column if not exists file_size_bytes                bigint,
  add column if not exists file_type_code                 integer,
  add column if not exists file_extension                 text,
  add column if not exists bitrate_kbps                   integer,
  add column if not exists bit_depth                      integer,
  add column if not exists sample_rate_hz                 integer,
  add column if not exists isrc                           text,
  add column if not exists hot_cue_auto_load              boolean,
  add column if not exists file_path_normalized           text,
  add column if not exists file_path_volume               text,
  add column if not exists file_path_casefold             text,
  add column if not exists source_metadata                jsonb not null default '{}'::jsonb;

update public.rekordbox_tracks
set source_title = title
where source_title is null
  and title <> '(untitled)';

update public.rekordbox_tracks
set duration_ms = duration_seconds::bigint * 1000
where duration_ms is null
  and duration_seconds is not null;

-- Constraints are guarded because some projects have the columns but not the
-- migration-history row, while others have the constraint already.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_tracks_camelot_key_check'
      and conrelid = 'public.rekordbox_tracks'::regclass
  ) then
    alter table public.rekordbox_tracks
      add constraint rekordbox_tracks_camelot_key_check
      check (camelot_key is null or camelot_key ~ '^(1[0-2]|[1-9])[AB]$') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_tracks_key_mode_check'
      and conrelid = 'public.rekordbox_tracks'::regclass
  ) then
    alter table public.rekordbox_tracks
      add constraint rekordbox_tracks_key_mode_check
      check (key_mode is null or key_mode in ('major', 'minor')) not valid;
  end if;

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

create index if not exists rekordbox_tracks_import_camelot_idx
  on public.rekordbox_tracks (import_id, camelot_key);
create index if not exists rekordbox_tracks_import_path_casefold_idx
  on public.rekordbox_tracks (import_id, file_path_casefold)
  where file_path_casefold is not null;
create index if not exists rekordbox_tracks_import_isrc_idx
  on public.rekordbox_tracks (import_id, isrc)
  where isrc is not null;
create index if not exists rekordbox_tracks_import_file_type_idx
  on public.rekordbox_tracks (import_id, file_type_code)
  where file_type_code is not null;
create index if not exists rekordbox_tracks_reused_from_idx
  on public.rekordbox_tracks (analysis_reused_from_track_id)
  where analysis_reused_from_track_id is not null;

-- ── Tables written during the same USB import transaction ───────────────────
create table if not exists public.rekordbox_cues (
  id                    uuid primary key default gen_random_uuid(),
  import_id             uuid not null references public.rekordbox_imports(id) on delete cascade,
  track_id              uuid not null references public.rekordbox_tracks(id) on delete cascade,
  rekordbox_cue_id      text,
  dedupe_key            text not null,
  cue_family            text not null,
  hot_cue_slot          integer,
  point_type            text not null,
  source_kind           text,
  start_usec            bigint,
  end_usec              bigint,
  start_ms              numeric(12,3),
  end_ms                numeric(12,3),
  color_table_index     integer,
  color_hex             text,
  color_name            text,
  comment               text,
  is_active_loop        boolean,
  beat_loop_numerator   integer,
  beat_loop_denominator integer,
  source_db_present     boolean not null default false,
  source_anlz_present   boolean not null default false,
  source_conflict       boolean not null default false,
  source_payload        jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rekordbox_cues_cue_family_check check (cue_family in ('hot', 'memory')),
  constraint rekordbox_cues_point_type_check check (point_type in ('cue', 'loop')),
  constraint rekordbox_cues_track_dedupe_unique unique (track_id, dedupe_key)
);

-- CREATE TABLE IF NOT EXISTS does not repair a partially-created table.
alter table public.rekordbox_cues
  add column if not exists import_id             uuid references public.rekordbox_imports(id) on delete cascade,
  add column if not exists track_id              uuid references public.rekordbox_tracks(id) on delete cascade,
  add column if not exists rekordbox_cue_id      text,
  add column if not exists dedupe_key            text,
  add column if not exists cue_family            text,
  add column if not exists hot_cue_slot          integer,
  add column if not exists point_type            text,
  add column if not exists source_kind           text,
  add column if not exists start_usec            bigint,
  add column if not exists end_usec              bigint,
  add column if not exists start_ms              numeric(12,3),
  add column if not exists end_ms                numeric(12,3),
  add column if not exists color_table_index     integer,
  add column if not exists color_hex             text,
  add column if not exists color_name            text,
  add column if not exists comment               text,
  add column if not exists is_active_loop        boolean,
  add column if not exists beat_loop_numerator   integer,
  add column if not exists beat_loop_denominator integer,
  add column if not exists source_db_present     boolean not null default false,
  add column if not exists source_anlz_present   boolean not null default false,
  add column if not exists source_conflict       boolean not null default false,
  add column if not exists source_payload        jsonb not null default '{}'::jsonb,
  add column if not exists created_at            timestamptz not null default now(),
  add column if not exists updated_at            timestamptz not null default now();

create index if not exists rekordbox_cues_import_id_idx
  on public.rekordbox_cues (import_id);
create index if not exists rekordbox_cues_track_id_idx
  on public.rekordbox_cues (track_id);
create index if not exists rekordbox_cues_track_start_ms_idx
  on public.rekordbox_cues (track_id, start_ms);

create table if not exists public.rekordbox_recommendation_edges (
  id                   uuid primary key default gen_random_uuid(),
  import_id            uuid not null references public.rekordbox_imports(id) on delete cascade,
  source_track_id      uuid not null references public.rekordbox_tracks(id) on delete cascade,
  target_track_id      uuid not null references public.rekordbox_tracks(id) on delete cascade,
  source_content_id    text,
  target_content_id    text,
  rating               integer,
  source_created_at    timestamptz,
  relationship_source  text not null,
  direction_preserved  boolean not null default true,
  source_payload       jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  constraint rekordbox_recommendation_edges_unique
    unique (import_id, source_track_id, target_track_id, relationship_source)
);

alter table public.rekordbox_recommendation_edges
  add column if not exists import_id            uuid references public.rekordbox_imports(id) on delete cascade,
  add column if not exists source_track_id      uuid references public.rekordbox_tracks(id) on delete cascade,
  add column if not exists target_track_id      uuid references public.rekordbox_tracks(id) on delete cascade,
  add column if not exists source_content_id    text,
  add column if not exists target_content_id    text,
  add column if not exists rating               integer,
  add column if not exists source_created_at    timestamptz,
  add column if not exists relationship_source  text,
  add column if not exists direction_preserved  boolean not null default true,
  add column if not exists source_payload       jsonb not null default '{}'::jsonb,
  add column if not exists created_at           timestamptz not null default now();

create index if not exists rekordbox_recommendation_edges_import_id_idx
  on public.rekordbox_recommendation_edges (import_id);
create index if not exists rekordbox_recommendation_edges_source_track_idx
  on public.rekordbox_recommendation_edges (source_track_id);
create index if not exists rekordbox_recommendation_edges_target_track_idx
  on public.rekordbox_recommendation_edges (target_track_id);

-- The service role performs writes, while authenticated users need read access.
alter table public.rekordbox_cues enable row level security;
alter table public.rekordbox_recommendation_edges enable row level security;

drop policy if exists "Users can select their own cues" on public.rekordbox_cues;
create policy "Users can select their own cues"
  on public.rekordbox_cues for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
      where rekordbox_imports.id = rekordbox_cues.import_id
        and rekordbox_imports.user_id = auth.uid()
    )
  );

drop policy if exists "Users can select their own recommendation edges"
  on public.rekordbox_recommendation_edges;
create policy "Users can select their own recommendation edges"
  on public.rekordbox_recommendation_edges for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
      where rekordbox_imports.id = rekordbox_recommendation_edges.import_id
        and rekordbox_imports.user_id = auth.uid()
    )
  );

-- Keep the startup recovery RPC available even on installations where the
-- optional discovery tables have not been installed yet. Dynamic SQL prevents
-- function creation from failing on a missing scrape_jobs relation.
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

notify pgrst, 'reload schema';

commit;
