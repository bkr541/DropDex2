-- Stage 8: optional, read-only Rekordbox .2EX / PVDI vocal intelligence.
-- This table stores only compact derived evidence. Raw .2EX ownership remains
-- in rekordbox_analysis_assets / private Storage and library readiness is not
-- coupled to the presence of a row here.

create table if not exists public.rekordbox_track_vocal_analysis (
  id                    uuid        primary key default gen_random_uuid(),
  import_id             uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id              uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  source_2ex_asset_id   uuid        references public.rekordbox_analysis_assets(id) on delete set null,
  source_tag            text        not null default 'PVDI',
  source_header_length  integer,
  source_u1             bigint,
  source_u2             bigint,
  frame_duration_ms     numeric(12,6),
  frame_count           integer     not null default 0,
  regions               jsonb       not null default '[]'::jsonb,
  integrity_status      text        not null,
  complete              boolean     not null default false,
  parse_warnings        jsonb       not null default '[]'::jsonb,
  parser_version        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rekordbox_track_vocal_analysis_track_unique unique (track_id),
  constraint rekordbox_track_vocal_analysis_integrity_check
    check (integrity_status in ('valid', 'invalid', 'unsupported')),
  constraint rekordbox_track_vocal_analysis_frame_count_check
    check (frame_count >= 0),
  constraint rekordbox_track_vocal_analysis_source_tag_check
    check (source_tag = 'PVDI')
);

create index if not exists rekordbox_track_vocal_analysis_import_id_idx
  on public.rekordbox_track_vocal_analysis (import_id);
create index if not exists rekordbox_track_vocal_analysis_track_id_idx
  on public.rekordbox_track_vocal_analysis (track_id);

alter table public.rekordbox_track_vocal_analysis enable row level security;

drop policy if exists "Users can select their own vocal analysis"
  on public.rekordbox_track_vocal_analysis;
create policy "Users can select their own vocal analysis"
  on public.rekordbox_track_vocal_analysis for select
  to authenticated
  using (
    exists (
      select 1
        from public.rekordbox_tracks
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_tracks.import_id
       where rekordbox_tracks.id = rekordbox_track_vocal_analysis.track_id
         and rekordbox_tracks.import_id = rekordbox_track_vocal_analysis.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );
