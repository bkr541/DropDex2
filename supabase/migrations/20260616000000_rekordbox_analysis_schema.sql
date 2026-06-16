-- ============================================================
-- DropDex: Rekordbox analysis-data schema
--
-- Extends rekordbox_imports and rekordbox_tracks with analysis
-- tracking columns, then creates eight new tables covering:
--   · Analysis asset manifests (DAT / EXT / 2EX files)
--   · Beat grids and downbeat positions
--   · Waveform data (preview in DB; detail in Storage)
--   · Hot Cues and Memory Cues
--   · Phrase analysis
--   · Device Library Plus recommendedLike edges
--   · Desktop Rekordbox Related Tracks lists and memberships
--
-- Safe on an existing database — all DDL uses IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS.  Existing rows are unaffected.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. EXTEND rekordbox_imports
-- ══════════════════════════════════════════════════════════════

alter table public.rekordbox_imports
  add column if not exists source_bundle_type             text,
  add column if not exists analysis_status                text,
  add column if not exists analysis_expected_track_count  integer     not null default 0,
  add column if not exists analysis_matched_track_count   integer     not null default 0,
  add column if not exists analysis_parsed_track_count    integer     not null default 0,
  add column if not exists analysis_failed_track_count    integer     not null default 0,
  add column if not exists analysis_asset_count           integer     not null default 0,
  add column if not exists analysis_parser_version        text,
  add column if not exists analysis_completed_at          timestamptz,
  add column if not exists analysis_warnings              jsonb       not null default '[]'::jsonb;

-- Validate allowed values; constraints are named so they can be
-- identified without ambiguity in future migrations.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name   = 'rekordbox_imports'
      and constraint_name = 'rekordbox_imports_source_bundle_type_check'
  ) then
    alter table public.rekordbox_imports
      add constraint rekordbox_imports_source_bundle_type_check
        check (source_bundle_type is null or source_bundle_type in (
          'database_only', 'usb_folder', 'zip_bundle', 'desktop_bridge'
        ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name   = 'rekordbox_imports'
      and constraint_name = 'rekordbox_imports_analysis_status_check'
  ) then
    alter table public.rekordbox_imports
      add constraint rekordbox_imports_analysis_status_check
        check (analysis_status is null or analysis_status in (
          'not_requested', 'awaiting_upload', 'uploading', 'uploaded',
          'parsing', 'completed', 'partial', 'failed'
        ));
  end if;
end $$;


-- ══════════════════════════════════════════════════════════════
-- 2. EXTEND rekordbox_tracks
-- ══════════════════════════════════════════════════════════════

alter table public.rekordbox_tracks
  add column if not exists master_db_id                   text,
  add column if not exists master_content_id              text,
  add column if not exists analysis_data_file_path        text,
  add column if not exists analysed_bits                  bigint,
  add column if not exists cue_update_count               bigint,
  add column if not exists analysis_data_update_count     bigint,
  add column if not exists information_update_count       bigint,
  add column if not exists analysis_reused_from_track_id  uuid        references public.rekordbox_tracks(id) on delete set null,
  add column if not exists analysis_parse_status          text,
  add column if not exists analysis_parse_warnings        jsonb       not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name   = 'rekordbox_tracks'
      and constraint_name = 'rekordbox_tracks_analysis_parse_status_check'
  ) then
    alter table public.rekordbox_tracks
      add constraint rekordbox_tracks_analysis_parse_status_check
        check (analysis_parse_status is null or analysis_parse_status in (
          'not_requested', 'queued', 'parsing', 'completed', 'partial', 'failed', 'skipped', 'reused'
        ));
  end if;
end $$;

create index if not exists rekordbox_tracks_reused_from_idx
  on public.rekordbox_tracks (analysis_reused_from_track_id)
  where analysis_reused_from_track_id is not null;


-- ══════════════════════════════════════════════════════════════
-- 3. rekordbox_analysis_assets
--    One row per uploaded DAT, EXT, or 2EX file.
--    Raw bytes are NOT stored here — only the Storage reference.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.rekordbox_analysis_assets (
  id                uuid        primary key default gen_random_uuid(),
  import_id         uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id          uuid        references public.rekordbox_tracks(id) on delete cascade,
  asset_type        text        not null,
  relative_path     text        not null,
  original_filename text        not null,
  sha256            text        not null,
  size_bytes        bigint,
  storage_bucket    text        not null default 'rekordbox-analysis-assets',
  storage_path      text        not null,
  upload_status     text        not null default 'pending',
  parse_status      text        not null default 'not_requested',
  parser_version    text,
  parse_warnings    jsonb       not null default '[]'::jsonb,
  uploaded_at       timestamptz,
  parsed_at         timestamptz,
  created_at        timestamptz not null default now(),
  constraint rekordbox_analysis_assets_asset_type_check
    check (asset_type in ('DAT', 'EXT', '2EX')),
  constraint rekordbox_analysis_assets_upload_status_check
    check (upload_status in ('pending', 'uploading', 'uploaded', 'failed')),
  constraint rekordbox_analysis_assets_parse_status_check
    check (parse_status in (
      'not_requested', 'queued', 'parsing', 'completed', 'failed', 'skipped'
    ))
);

-- Expression-based unique index — function calls are not valid inside UNIQUE constraints.
create unique index if not exists rekordbox_analysis_assets_import_path_unique
  on public.rekordbox_analysis_assets (import_id, lower(relative_path));

create index if not exists rekordbox_analysis_assets_import_id_idx
  on public.rekordbox_analysis_assets (import_id);
create index if not exists rekordbox_analysis_assets_track_id_idx
  on public.rekordbox_analysis_assets (track_id);
create index if not exists rekordbox_analysis_assets_sha256_idx
  on public.rekordbox_analysis_assets (sha256);
-- (import_id, lower(relative_path)) is already covered by the unique index above.


-- ══════════════════════════════════════════════════════════════
-- 4. rekordbox_track_beat_grids
--    One row per track; beats array is stored as JSONB.
--    Each beats element: { seq, srcIdx, beatInBar, bar, ms, bpm, isDownbeat }
-- ══════════════════════════════════════════════════════════════

create table if not exists public.rekordbox_track_beat_grids (
  id                  uuid        primary key default gen_random_uuid(),
  import_id           uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id            uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  source_tag          text,
  beats               jsonb       not null default '[]'::jsonb,
  beat_count          integer,
  downbeat_count      integer,
  bar_count           integer,
  first_beat_ms       numeric(12,3),
  first_downbeat_ms   numeric(12,3),
  minimum_bpm         numeric(7,2),
  maximum_bpm         numeric(7,2),
  is_variable_tempo   boolean,
  parser_version      text,
  source_asset_id     uuid        references public.rekordbox_analysis_assets(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint rekordbox_track_beat_grids_track_unique
    unique (track_id)
);

create index if not exists rekordbox_track_beat_grids_import_id_idx
  on public.rekordbox_track_beat_grids (import_id);
create index if not exists rekordbox_track_beat_grids_track_id_idx
  on public.rekordbox_track_beat_grids (track_id);


-- ══════════════════════════════════════════════════════════════
-- 5. rekordbox_track_waveforms
--    One row per track.
--    Compact preview columns stay in PostgreSQL.
--    Full scrolling/detail waveform lives in private Storage.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.rekordbox_track_waveforms (
  id                    uuid        primary key default gen_random_uuid(),
  import_id             uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id              uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  preview_format        text,
  preview_column_count  integer,
  preview_columns       jsonb       not null default '[]'::jsonb,
  detail_format         text,
  detail_column_count   integer,
  detail_storage_bucket text,
  detail_storage_path   text,
  source_dat_asset_id   uuid        references public.rekordbox_analysis_assets(id) on delete set null,
  source_ext_asset_id   uuid        references public.rekordbox_analysis_assets(id) on delete set null,
  source_2ex_asset_id   uuid        references public.rekordbox_analysis_assets(id) on delete set null,
  parser_version        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rekordbox_track_waveforms_track_unique
    unique (track_id)
);

create index if not exists rekordbox_track_waveforms_import_id_idx
  on public.rekordbox_track_waveforms (import_id);
create index if not exists rekordbox_track_waveforms_track_id_idx
  on public.rekordbox_track_waveforms (track_id);


-- ══════════════════════════════════════════════════════════════
-- 6. rekordbox_cues
--    Hot Cues and Memory Cues, merged from DB and ANLZ sources.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.rekordbox_cues (
  id                    uuid        primary key default gen_random_uuid(),
  import_id             uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id              uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  rekordbox_cue_id      text,
  -- Stable identifier for merging DB and ANLZ sources; unique per track
  dedupe_key            text        not null,
  cue_family            text        not null,
  hot_cue_slot          integer,
  point_type            text        not null,
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
  source_db_present     boolean     not null default false,
  source_anlz_present   boolean     not null default false,
  source_conflict       boolean     not null default false,
  source_payload        jsonb       not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rekordbox_cues_cue_family_check
    check (cue_family in ('hot', 'memory')),
  constraint rekordbox_cues_point_type_check
    check (point_type in ('cue', 'loop')),
  constraint rekordbox_cues_track_dedupe_unique
    unique (track_id, dedupe_key)
);

create index if not exists rekordbox_cues_import_id_idx
  on public.rekordbox_cues (import_id);
create index if not exists rekordbox_cues_track_id_idx
  on public.rekordbox_cues (track_id);
-- Primary access pattern: all cues for a track in start-time order
create index if not exists rekordbox_cues_track_start_ms_idx
  on public.rekordbox_cues (track_id, start_ms);


-- ══════════════════════════════════════════════════════════════
-- 7. rekordbox_track_phrases
--    Rekordbox phrase analysis segments.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.rekordbox_track_phrases (
  id                uuid        primary key default gen_random_uuid(),
  import_id         uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id          uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  phrase_index      integer     not null,
  source_mood       text,
  source_kind       text,
  source_bank       text,
  normalized_label  text,
  start_beat        integer,
  end_beat          integer,
  start_ms          numeric(12,3),
  end_ms            numeric(12,3),
  fill_start_beat   integer,
  fill_start_ms     numeric(12,3),
  source_flags      jsonb       not null default '{}'::jsonb,
  source_payload    jsonb       not null default '{}'::jsonb,
  parser_version    text,
  created_at        timestamptz not null default now(),
  constraint rekordbox_track_phrases_track_index_unique
    unique (track_id, phrase_index)
);

create index if not exists rekordbox_track_phrases_import_id_idx
  on public.rekordbox_track_phrases (import_id);
create index if not exists rekordbox_track_phrases_track_id_idx
  on public.rekordbox_track_phrases (track_id);
-- Primary access pattern: all phrases for a track in order
create index if not exists rekordbox_track_phrases_track_index_idx
  on public.rekordbox_track_phrases (track_id, phrase_index);


-- ══════════════════════════════════════════════════════════════
-- 8. rekordbox_recommendation_edges
--    Device Library Plus recommendedLike records.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.rekordbox_recommendation_edges (
  id                   uuid        primary key default gen_random_uuid(),
  import_id            uuid        not null references public.rekordbox_imports(id) on delete cascade,
  source_track_id      uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  target_track_id      uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  source_content_id    text,
  target_content_id    text,
  rating               integer,
  source_created_at    timestamptz,
  relationship_source  text        not null,
  direction_preserved  boolean     not null default true,
  source_payload       jsonb       not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  constraint rekordbox_recommendation_edges_unique
    unique (import_id, source_track_id, target_track_id, relationship_source)
);

create index if not exists rekordbox_recommendation_edges_import_id_idx
  on public.rekordbox_recommendation_edges (import_id);
create index if not exists rekordbox_recommendation_edges_source_track_idx
  on public.rekordbox_recommendation_edges (source_track_id);
create index if not exists rekordbox_recommendation_edges_target_track_idx
  on public.rekordbox_recommendation_edges (target_track_id);


-- ══════════════════════════════════════════════════════════════
-- 9. rekordbox_related_track_lists
--    Desktop Rekordbox Related Tracks folders and lists.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.rekordbox_related_track_lists (
  id                    uuid        primary key default gen_random_uuid(),
  import_id             uuid        not null references public.rekordbox_imports(id) on delete cascade,
  source_list_id        text        not null,
  parent_list_id        uuid        references public.rekordbox_related_track_lists(id) on delete cascade,
  name                  text        not null,
  sort_order            integer,
  is_folder             boolean     not null default false,
  attribute             text,
  criteria_raw          jsonb       not null default '{}'::jsonb,
  criteria_normalized   jsonb       not null default '{}'::jsonb,
  source_database_id    text,
  created_at            timestamptz not null default now(),
  constraint rekordbox_related_track_lists_import_list_unique
    unique (import_id, source_list_id)
);

create index if not exists rekordbox_related_track_lists_import_id_idx
  on public.rekordbox_related_track_lists (import_id);
create index if not exists rekordbox_related_track_lists_parent_id_idx
  on public.rekordbox_related_track_lists (parent_list_id)
  where parent_list_id is not null;


-- ══════════════════════════════════════════════════════════════
-- 10. rekordbox_related_track_members
--     Ordered track membership in a Related Tracks list.
--     position is 1-based and unique within each list.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.rekordbox_related_track_members (
  related_list_id   uuid        not null references public.rekordbox_related_track_lists(id) on delete cascade,
  track_id          uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  position          integer     not null,
  relationship_type text,
  source_payload    jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  constraint rekordbox_related_track_members_pkey
    primary key (related_list_id, position),
  constraint rekordbox_related_track_members_unique_member
    unique (related_list_id, track_id)
);

create index if not exists rekordbox_related_track_members_list_pos_idx
  on public.rekordbox_related_track_members (related_list_id, position);
create index if not exists rekordbox_related_track_members_track_id_idx
  on public.rekordbox_related_track_members (track_id);


-- ══════════════════════════════════════════════════════════════
-- 11. ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════

alter table public.rekordbox_analysis_assets      enable row level security;
alter table public.rekordbox_track_beat_grids     enable row level security;
alter table public.rekordbox_track_waveforms      enable row level security;
alter table public.rekordbox_cues                 enable row level security;
alter table public.rekordbox_track_phrases        enable row level security;
alter table public.rekordbox_recommendation_edges enable row level security;
alter table public.rekordbox_related_track_lists  enable row level security;
alter table public.rekordbox_related_track_members enable row level security;

-- Helper macro: SELECT policy — join through rekordbox_imports to verify ownership.
-- PostgreSQL has no CREATE POLICY IF NOT EXISTS, so drop first.

-- ── rekordbox_analysis_assets ─────────────────────────────────

drop policy if exists "Users can select their own analysis assets" on public.rekordbox_analysis_assets;
create policy "Users can select their own analysis assets"
  on public.rekordbox_analysis_assets for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_analysis_assets.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- ── rekordbox_track_beat_grids ────────────────────────────────

drop policy if exists "Users can select their own beat grids" on public.rekordbox_track_beat_grids;
create policy "Users can select their own beat grids"
  on public.rekordbox_track_beat_grids for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_track_beat_grids.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- ── rekordbox_track_waveforms ─────────────────────────────────

drop policy if exists "Users can select their own waveforms" on public.rekordbox_track_waveforms;
create policy "Users can select their own waveforms"
  on public.rekordbox_track_waveforms for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_track_waveforms.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- ── rekordbox_cues ────────────────────────────────────────────

drop policy if exists "Users can select their own cues" on public.rekordbox_cues;
create policy "Users can select their own cues"
  on public.rekordbox_cues for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_cues.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- ── rekordbox_track_phrases ───────────────────────────────────

drop policy if exists "Users can select their own phrases" on public.rekordbox_track_phrases;
create policy "Users can select their own phrases"
  on public.rekordbox_track_phrases for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_track_phrases.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- ── rekordbox_recommendation_edges ───────────────────────────

drop policy if exists "Users can select their own recommendation edges" on public.rekordbox_recommendation_edges;
create policy "Users can select their own recommendation edges"
  on public.rekordbox_recommendation_edges for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_recommendation_edges.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- ── rekordbox_related_track_lists ─────────────────────────────

drop policy if exists "Users can select their own related track lists" on public.rekordbox_related_track_lists;
create policy "Users can select their own related track lists"
  on public.rekordbox_related_track_lists for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_related_track_lists.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- ── rekordbox_related_track_members ──────────────────────────
-- No import_id here — join through the list row.

drop policy if exists "Users can select their own related track members" on public.rekordbox_related_track_members;
create policy "Users can select their own related track members"
  on public.rekordbox_related_track_members for select
  to authenticated
  using (
    exists (
      select 1
        from public.rekordbox_related_track_lists l
        join public.rekordbox_imports i on i.id = l.import_id
       where l.id        = rekordbox_related_track_members.related_list_id
         and i.user_id   = auth.uid()
    )
  );


-- ══════════════════════════════════════════════════════════════
-- 12. STORAGE — rekordbox-analysis-assets (private bucket)
--
-- Object path layout:
--   {user_id}/{import_id}/{track_id}/{sha256}/{filename}
--
-- The backend writes via the service-role key (bypasses RLS).
-- Authenticated users may read their own objects.
-- No client-side INSERT or UPDATE policies.
-- ══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rekordbox-analysis-assets',
  'rekordbox-analysis-assets',
  false,
  524288000,   -- 500 MB per object; individual ANLZ files are rarely > 50 MB
  null         -- no MIME restriction — DAT/EXT/2EX are application/octet-stream
)
on conflict (id) do nothing;

-- Read access: authenticated users may read only objects under their own user_id folder.
drop policy if exists "rekordbox-analysis-assets: authenticated users read own files"
  on storage.objects;

create policy "rekordbox-analysis-assets: authenticated users read own files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'rekordbox-analysis-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
