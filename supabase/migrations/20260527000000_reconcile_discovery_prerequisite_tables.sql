-- ============================================================================
-- DropDex Migration: Reconcile discovery prerequisite tables
--
-- These tables were provisioned outside migration history (directly in the
-- Supabase dashboard or via a separate tool) for the deployed project.  This
-- migration creates them safely for clean environments using
-- CREATE TABLE IF NOT EXISTS so that the live database is not affected.
--
-- ORDERING NOTE
-- ─────────────
-- This migration bears a timestamp earlier than the genre and discovery
-- migrations (010000–030000) which all reference public.artists.  On a fresh
-- database the correct application order is therefore:
--   000000 (this file) → 010000 → 020000 → 030000 → 040000 → 050000
--
-- On the already-deployed Supabase project, where 010000–030000 are applied,
-- this migration is applied as a no-op (every statement uses IF NOT EXISTS).
--
-- TABLES CREATED
-- ─────────────
--   public.artists              – canonical artist catalog
--   public.artist_aliases       – alternative name spellings
--   public.artist_search_runs   – per-page scrape audit records
--   public.artist_set_results   – deduplicated setlist catalog entries
--   public.artist_set_result_artists – junction: result ↔ artist
-- ============================================================================

begin;

-- ── public.artists ────────────────────────────────────────────────────────────
--
-- Canonical artist record.  Source of truth for artist identity throughout
-- the discovery pipeline.  Populated from the 1001Tracklists site database
-- and backfilled via migration 020000.

create table if not exists public.artists (
  id                uuid        primary key default gen_random_uuid(),
  name              text        not null,
  normalized_name   text,
  aliases           text[],
  source            text        not null default '1001tracklists',
  source_artist_url text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists artists_normalized_name_uidx
  on public.artists (normalized_name)
  where normalized_name is not null;

create index if not exists artists_name_idx
  on public.artists (name);


-- ── public.artist_aliases ─────────────────────────────────────────────────────
--
-- Alternative names and spellings for artists (b2b combos, regional spellings,
-- typos).  Searched as a fallback after the primary normalized_name lookup.

create table if not exists public.artist_aliases (
  id               uuid        primary key default gen_random_uuid(),
  artist_id        uuid        not null references public.artists(id) on delete cascade,
  alias_text       text        not null,
  normalized_alias text        not null,
  created_at       timestamptz not null default now()
);

create index if not exists artist_aliases_artist_id_idx
  on public.artist_aliases (artist_id);

create index if not exists artist_aliases_normalized_alias_idx
  on public.artist_aliases (normalized_alias);


-- ── public.artist_search_runs ─────────────────────────────────────────────────
--
-- One row per paginated scrape execution.  Multiple runs may belong to a single
-- scrape_jobs row (one per page scraped).  The scrape_job_id FK to
-- public.scrape_jobs is added conditionally in migration 030000; it is guarded
-- with NOT VALID to avoid a full-table validation scan on large datasets.

create table if not exists public.artist_search_runs (
  id               uuid        primary key default gen_random_uuid(),
  artist_id        uuid        not null references public.artists(id) on delete cascade,
  -- scrape_job_id FK to public.scrape_jobs is wired by migration 030000
  scrape_job_id    uuid,
  search_query     text        not null,
  source           text        not null default '1001tracklists',
  source_url       text,
  total_results    integer,
  page_number      integer,
  sort_order       text,
  scraped_at       timestamptz not null default now(),
  raw_metadata_json jsonb
);

create index if not exists artist_search_runs_artist_id_idx
  on public.artist_search_runs (artist_id);

create index if not exists artist_search_runs_scrape_job_id_idx
  on public.artist_search_runs (scrape_job_id);


-- ── public.artist_set_results ─────────────────────────────────────────────────
--
-- SHARED SETLIST CATALOG
-- ─────────────────────
-- Each row represents one unique setlist entry from 1001Tracklists.
-- Rows are globally deduplicated on (source, source_tracklist_id) so that
-- the same event discovered via ILLENIUM and later via Crankdat becomes
-- a single row with refreshed mutable metadata.
--
-- artist_id:    PROVENANCE ONLY — the first artist whose scrape created this
--               row.  Do NOT use this column to retrieve an artist's setlists;
--               use public.artist_set_result_artists (the authoritative
--               many-to-many junction) instead.
-- search_run_id: the search run that originally produced this row (provenance).

create table if not exists public.artist_set_results (
  id                    uuid        primary key default gen_random_uuid(),
  -- Provenance columns — set on first insert, never overwritten on conflict.
  artist_id             uuid        references public.artists(id) on delete set null,
  search_run_id         uuid        references public.artist_search_runs(id) on delete set null,
  -- Source identity — forms the deduplication key.
  source                text        not null,
  source_tracklist_id   text        not null,
  -- Mutable source metadata — refreshed on every upsert conflict.
  source_url            text,
  title                 text        not null,
  normalized_title      text,
  event_name            text,
  venue                 text,
  city                  text,
  state_region          text,
  country               text,
  location_raw          text,
  set_date              date,
  date_raw              text,
  artwork_url           text,
  ided_tracks           integer,
  total_tracks          integer,
  completion_pct        numeric(5, 2),
  duration_text         text,
  duration_seconds      integer,
  music_styles          text[]      not null default '{}',
  listen_sources        jsonb,
  views                 integer,
  likes                 integer,
  comments_count        integer,
  creator_username      text,
  creator_profile_url   text,
  creator_score         integer,
  created_age_text      text,
  updated_age_text      text,
  raw_result_json       jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Global deduplication key — enables safe ON CONFLICT upserts.
create unique index if not exists artist_set_results_source_tracklist_uidx
  on public.artist_set_results (source, source_tracklist_id);

-- Sorting index — results are always ordered set_date DESC NULLS LAST.
create index if not exists artist_set_results_set_date_idx
  on public.artist_set_results (set_date desc nulls last);


-- ── public.artist_set_result_artists ─────────────────────────────────────────
--
-- AUTHORITATIVE ARTIST ↔ SETLIST RELATIONSHIP
-- ────────────────────────────────────────────
-- Many-to-many junction between a shared setlist result and every DropDex
-- artist for whom it has been discovered or manually linked.
--
-- Query artist setlists by filtering on THIS table (artist_id), then joining
-- to artist_set_results for the setlist data — never filter directly on
-- artist_set_results.artist_id (provenance column only).

create table if not exists public.artist_set_result_artists (
  id              uuid        primary key default gen_random_uuid(),
  set_result_id   uuid        not null references public.artist_set_results(id) on delete cascade,
  artist_id       uuid        not null,
  display_name    text,
  normalized_name text,
  role            text,
  created_at      timestamptz not null default now()
);

create index if not exists artist_set_result_artists_artist_id_idx
  on public.artist_set_result_artists (artist_id);

create index if not exists artist_set_result_artists_set_result_id_idx
  on public.artist_set_result_artists (set_result_id);

commit;
