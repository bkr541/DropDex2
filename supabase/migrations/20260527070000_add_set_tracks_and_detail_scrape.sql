-- ============================================================================
-- DropDex Migration: Set-track storage and detail-scrape tracking
--
-- This migration has two parts:
--
--   1. Extend public.artist_set_results with columns that track whether the
--      individual tracks inside a setlist have been scraped.
--
--   2. Create public.artist_set_tracks to store individual tracks discovered
--      from a 1001Tracklists setlist detail page.
--
-- DOMAIN BOUNDARY
-- ───────────────
-- artist_set_tracks is intentionally separate from all rekordbox_* tables.
-- rekordbox_* = tracks imported from the user's local Rekordbox library.
-- artist_set_tracks = tracks discovered from public artist setlists.
-- A later feature will compare these two domains; they must remain distinct.
--
-- IDEMPOTENCY
-- ───────────
-- All statements use IF NOT EXISTS or ADD COLUMN IF NOT EXISTS.
-- Re-applying this migration to a database where the schema already matches
-- is safe and produces no errors.
-- ============================================================================

begin;

-- ── Part 1: Extend artist_set_results ────────────────────────────────────────
--
-- detail_scrape_status tracks whether this result's individual tracks have
-- been fetched from the 1001Tracklists setlist detail page.
-- Lifecycle: not_scraped → queued → running → completed | failed
-- Default 'not_scraped' matches all existing rows without any backfill.

alter table public.artist_set_results
  add column if not exists detail_scrape_status        text        not null default 'not_scraped';

alter table public.artist_set_results
  add column if not exists detail_scraped_at           timestamptz null;

alter table public.artist_set_results
  add column if not exists detail_scrape_error         text        null;

-- Numeric tracklist ID from 1001Tracklists (from form#frmEditTracklist
-- input[name="id_tracklist"]). Stored as text to avoid integer overflow risk
-- and because it is only ever used as an opaque identifier, not for arithmetic.
alter table public.artist_set_results
  add column if not exists source_numeric_tracklist_id text        null;

-- How many track positions the detail page reported (from tl_pos_count input).
alter table public.artist_set_results
  add column if not exists parsed_track_count          integer     null;

-- True when the scraped detail page contained at least one visible cue time.
-- Null until a detail scrape has completed.
alter table public.artist_set_results
  add column if not exists has_timed_cues              boolean     null;

-- Free-form JSON preserved from the detail page for debugging parser changes.
alter table public.artist_set_results
  add column if not exists raw_detail_metadata_json    jsonb       null;

-- Add check constraint for detail_scrape_status if not already present.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema    = 'public'
       and table_name      = 'artist_set_results'
       and constraint_name = 'artist_set_results_detail_status_check'
  ) then
    alter table public.artist_set_results
      add constraint artist_set_results_detail_status_check
      check (detail_scrape_status in (
        'not_scraped', 'queued', 'running', 'completed', 'failed'
      ));
  end if;
end $$;

-- Index to quickly find results that still need detail scraping.
create index if not exists artist_set_results_detail_status_idx
  on public.artist_set_results (detail_scrape_status);


-- ── Part 2: Create public.artist_set_tracks ───────────────────────────────────
--
-- One row per track position on a 1001Tracklists setlist detail page.
-- Rows are ordered by sequence_index (derived from data-trno), which preserves
-- the original set order including w/ layered entries.

create table if not exists public.artist_set_tracks (
  id                   uuid        primary key default gen_random_uuid(),

  -- Which discovered setlist this track belongs to.
  set_result_id        uuid        not null
                                   references public.artist_set_results(id)
                                   on delete cascade,

  -- Source website; always '1001tracklists' for now.
  source               text        not null default '1001tracklists',

  -- data-id from the tlpItem div: unique within a page, stable across scrapes.
  source_position_id   text        not null,

  -- data-trackid from the tlpItem div; null for unidentified / ID tracks.
  source_track_id      text        null,

  -- 0-based position derived from data-trno. Stable ordering including w/ rows.
  sequence_index       integer     not null,

  -- Visible track number (e.g., 1, 2, 3). Null for w/ layered rows.
  track_number         integer     null,

  -- True when this row is displayed as "w/" beneath a primary track.
  played_with_previous boolean     not null default false,

  -- Cue time in integer seconds. Null when no visible cue is displayed.
  -- 0 only when the page explicitly shows "00:00".
  cue_seconds          integer     null,

  -- Raw cue display text (e.g., "00:10", "1:26:10"). Null when untimed.
  cue_text             text        null,

  -- Track title parsed from meta[itemprop="name"].
  title                text        null,

  -- Artist string parsed from meta[itemprop="byArtist"].
  artist_text          text        null,

  -- Label name parsed from meta[itemprop="publisher"] inner HTML.
  label_text           text        null,

  -- Duration in integer seconds (PT3M49S → 229). Null when absent.
  duration_seconds     integer     null,

  -- Raw duration text as it appeared on the page (e.g., "3:49"). Null when absent.
  duration_text        text        null,

  -- Absolute URL to the 1001Tracklists track page; null for unidentified tracks.
  source_track_url     text        null,

  -- Artwork URL from img.artwork or img.artM data-src; null when absent/placeholder.
  artwork_url          text        null,

  -- Raw JSON snapshot of parsed attributes for future debugging.
  raw_track_json       jsonb       null,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- One position per set (set_result_id, source_position_id must be unique).
  constraint artist_set_tracks_set_position_uidx
    unique (set_result_id, source_position_id),

  -- Sequence index must also be unique per set.
  constraint artist_set_tracks_set_sequence_uidx
    unique (set_result_id, sequence_index)
);

-- Primary lookup pattern: retrieve all tracks for a set in order.
create index if not exists artist_set_tracks_set_sequence_idx
  on public.artist_set_tracks (set_result_id, sequence_index);

-- Lookup by source_track_id across all sets (for future library comparison).
create index if not exists artist_set_tracks_source_track_id_idx
  on public.artist_set_tracks (source_track_id)
  where source_track_id is not null;


-- ── updated_at trigger for artist_set_tracks ──────────────────────────────────
--
-- Reuse the same trigger function pattern used elsewhere in this schema.
-- The function moddatetime() is provided by the Supabase-bundled
-- moddatetime extension. If that function is not available (e.g., local dev
-- without the extension), the trigger creation is skipped gracefully.

do $$
begin
  if exists (
    select 1 from pg_proc
     where proname = 'moddatetime'
       and pronamespace = (select oid from pg_namespace where nspname = 'extensions')
  ) then
    execute $trig$
      create trigger artist_set_tracks_updated_at
        before update on public.artist_set_tracks
        for each row
        execute function extensions.moddatetime(updated_at);
    $trig$;
  end if;
exception
  when duplicate_object then null;  -- trigger already exists; skip
end $$;

commit;
