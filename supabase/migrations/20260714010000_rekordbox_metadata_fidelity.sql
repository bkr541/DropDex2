-- ============================================================
-- DropDex: Rekordbox metadata fidelity and analysis integrity
--
-- Preserves exact Device Library Plus values alongside the existing
-- presentation-friendly columns. New columns are nullable and therefore safe
-- for existing imports; old snapshots can be reparsed to populate them.
-- ============================================================

alter table public.rekordbox_tracks
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

-- Preserve the distinction between missing source titles and the legacy UI
-- placeholder while keeping title NOT NULL for existing application code.
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

comment on column public.rekordbox_tracks.source_title is
  'Raw nullable Device Library Plus title. title remains the presentation fallback.';
comment on column public.rekordbox_tracks.duration_ms is
  'Exact source duration in milliseconds; prefer over duration_seconds for timing.';
comment on column public.rekordbox_tracks.file_type_code is
  'Raw Device Library Plus fileType integer, retained even when no label is known.';
comment on column public.rekordbox_tracks.source_metadata is
  'JSON-safe copy of scalar Device Library Plus Content columns for forward compatibility.';

-- ── Conservative data-quality checks ─────────────────────────────────────────
-- NOT VALID avoids blocking deployment because of legacy rows while enforcing
-- the rules for all new writes immediately.

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

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_waveforms_counts_check'
      and conrelid = 'public.rekordbox_track_waveforms'::regclass
  ) then
    alter table public.rekordbox_track_waveforms
      add constraint rekordbox_waveforms_counts_check
      check (
        (preview_column_count is null or preview_column_count >= 0)
        and (detail_column_count is null or detail_column_count >= 0)
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_waveforms_preview_shape_check'
      and conrelid = 'public.rekordbox_track_waveforms'::regclass
  ) then
    alter table public.rekordbox_track_waveforms
      add constraint rekordbox_waveforms_preview_shape_check
      check (
        jsonb_typeof(preview_columns) = 'array'
        and (
          preview_column_count is null
          or jsonb_array_length(preview_columns) = preview_column_count
        )
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_waveforms_detail_location_check'
      and conrelid = 'public.rekordbox_track_waveforms'::regclass
  ) then
    alter table public.rekordbox_track_waveforms
      add constraint rekordbox_waveforms_detail_location_check
      check (
        (detail_storage_bucket is null and detail_storage_path is null)
        or (detail_storage_bucket is not null and detail_storage_path is not null)
      ) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_cues_hot_slot_check'
      and conrelid = 'public.rekordbox_cues'::regclass
  ) then
    alter table public.rekordbox_cues
      add constraint rekordbox_cues_hot_slot_check
      check (hot_cue_slot is null or hot_cue_slot between 1 and 8) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_cues_time_order_check'
      and conrelid = 'public.rekordbox_cues'::regclass
  ) then
    alter table public.rekordbox_cues
      add constraint rekordbox_cues_time_order_check
      check (end_ms is null or start_ms is null or end_ms >= start_ms) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_cues_loop_end_check'
      and conrelid = 'public.rekordbox_cues'::regclass
  ) then
    alter table public.rekordbox_cues
      add constraint rekordbox_cues_loop_end_check
      check (point_type <> 'loop' or end_ms is not null) not valid;
  end if;
end $$;

-- ── Cross-import integrity ────────────────────────────────────────────────────
-- Analysis rows carry both track_id and import_id. Composite foreign keys stop
-- a service-role writer from accidentally attaching Track B to Import A.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_tracks_id_import_unique'
      and conrelid = 'public.rekordbox_tracks'::regclass
  ) then
    alter table public.rekordbox_tracks
      add constraint rekordbox_tracks_id_import_unique unique (id, import_id);
  end if;
end $$;


do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('rekordbox_analysis_assets', 'track_id', 'rekordbox_analysis_assets_track_import_fk'),
      ('rekordbox_track_beat_grids', 'track_id', 'rekordbox_beat_grids_track_import_fk'),
      ('rekordbox_track_waveforms', 'track_id', 'rekordbox_waveforms_track_import_fk'),
      ('rekordbox_cues', 'track_id', 'rekordbox_cues_track_import_fk'),
      ('rekordbox_track_phrases', 'track_id', 'rekordbox_phrases_track_import_fk')
    ) as rows(table_name, track_column, constraint_name)
  loop
    if not exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conname = item.constraint_name
        and constraint_row.conrelid = format('public.%I', item.table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I, import_id) references public.rekordbox_tracks(id, import_id) on delete cascade not valid',
        item.table_name,
        item.constraint_name,
        item.track_column
      );
    end if;
  end loop;
end $$;


do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_recommendations_source_import_fk'
      and conrelid = 'public.rekordbox_recommendation_edges'::regclass
  ) then
    alter table public.rekordbox_recommendation_edges
      add constraint rekordbox_recommendations_source_import_fk
      foreign key (source_track_id, import_id)
      references public.rekordbox_tracks(id, import_id)
      on delete cascade not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'rekordbox_recommendations_target_import_fk'
      and conrelid = 'public.rekordbox_recommendation_edges'::regclass
  ) then
    alter table public.rekordbox_recommendation_edges
      add constraint rekordbox_recommendations_target_import_fk
      foreign key (target_track_id, import_id)
      references public.rekordbox_tracks(id, import_id)
      on delete cascade not valid;
  end if;
end $$;
