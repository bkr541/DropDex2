-- ============================================================================
-- DropDex Migration: Discovery scrape job support
-- Adds public.scrape_jobs and public.artist_search_pages, and safely
-- reconciles the live schema's FK from artist_search_runs → scrape_jobs.
--
-- This migration is additive and idempotent. It does not modify any existing
-- rekordbox import tables, existing RLS policies, or existing discovery data.
-- ============================================================================
--
-- PREREQUISITE TABLES PRESENT IN LIVE SCHEMA BUT NOT IN REPO MIGRATIONS
-- -----------------------------------------------------------------------
-- The following tables exist in the deployed Supabase project as of the
-- snapshot in "Supabase Snippet 1001Tracklists Setlist Scrape Schema.csv".
-- They were provisioned outside migration history (directly in the dashboard
-- or via a separate tool). They are NOT recreated here; they must exist
-- before this migration is applied.
--
--   public.artists
--     Canonical artist catalog. Source of truth: 1001tracklists.
--     Columns: id, name, normalized_name, aliases, source, source_artist_url,
--              created_at, updated_at
--
--   public.artist_aliases
--     Alternative names and spellings for artists.
--     Columns: id, artist_id → artists(id), alias_text, normalized_alias,
--              created_at
--
--   public.artist_search_runs
--     One row per paginated scrape pass of a 1001Tracklists search result page.
--     Columns: id, artist_id → artists(id), scrape_job_id → scrape_jobs(id),
--              search_query, source, source_url, total_results, page_number,
--              sort_order, scraped_at, raw_metadata_json
--
--   public.artist_set_results
--     Individual setlist entries discovered via scraping. Deduplicated by
--     (source, source_tracklist_id) so repeated scrape jobs can upsert safely.
--     Columns: id, artist_id, search_run_id, source, source_tracklist_id,
--              source_url, title, normalized_title, event_name, venue, city,
--              state_region, country, location_raw, set_date, date_raw,
--              artwork_url, ided_tracks, total_tracks, completion_pct,
--              duration_text, duration_seconds, music_styles, listen_sources,
--              views, likes, comments_count, creator_username,
--              creator_profile_url, creator_score, created_age_text,
--              updated_age_text, raw_result_json, created_at, updated_at
--
--   public.artist_set_result_artists
--     Junction table linking a setlist result to the artists who performed.
--     Columns: id, set_result_id → artist_set_results(id), artist_id,
--              display_name, normalized_name, role, created_at
--
-- WHY these are shared catalog, not per-user private data:
--   Setlist discovery results represent publicly scraped event information.
--   They are the same for all users who search for the same artist. Storing
--   them as shared catalog (RLS disabled, written by service_role) avoids
--   duplicating thousands of rows per user and enables cross-user dedup.
-- ============================================================================

begin;

-- ── public.scrape_jobs ───────────────────────────────────────────────────────
--
-- Tracks one scrape operation end-to-end. A single job may spawn multiple
-- artist_search_runs (one per page). The status lifecycle is:
--   queued → running → completed | failed
--
-- RLS is intentionally NOT enabled here. scrape_jobs is part of the shared
-- discovery catalog written exclusively by the service-role backend key.
-- Enabling row-level security would require explicit service-role bypass
-- policies and could silently block backend writes. Apply RLS to the whole
-- discovery surface together if that access model changes.

create table if not exists public.scrape_jobs (
  id                      uuid        primary key default gen_random_uuid(),
  -- which signed-in user requested this scrape; nullable so rows survive user deletion
  requested_by_user_id    uuid        references auth.users(id) on delete set null,
  job_type                text        not null default 'artist_setlist_discovery',
  source                  text        not null default '1001tracklists',
  artist_id               uuid        references public.artists(id) on delete cascade,
  status                  text        not null default 'queued',
  pages_scraped           integer     not null default 0,
  results_found           integer     not null default 0,
  -- total count reported by the source site on page 1; may differ from results_found
  total_results_reported  integer,
  error_message           text,
  started_at              timestamptz,
  completed_at            timestamptz,
  created_at              timestamptz not null default now(),
  constraint scrape_jobs_status_check
    check (status in ('queued', 'running', 'completed', 'failed'))
);

create index if not exists scrape_jobs_artist_id_idx
  on public.scrape_jobs (artist_id);

create index if not exists scrape_jobs_requested_by_user_id_idx
  on public.scrape_jobs (requested_by_user_id);

-- allows efficient polling for active/pending jobs without a full table scan
create index if not exists scrape_jobs_status_idx
  on public.scrape_jobs (status);


-- ── public.artist_search_pages ───────────────────────────────────────────────
--
-- Stores per-page audit data for each search run. A single artist_search_run
-- maps to one page on 1001Tracklists, but this table captures the raw metadata
-- and result count per page so that:
--   - Pagination bugs can be diagnosed without re-scraping.
--   - If the source site changes its result structure, historical snapshots
--     remain for comparison.
--   - Partial re-scrapes can resume from a known page without losing context.
--
-- (source, source_tracklist_id) deduplication lives on artist_set_results;
-- artist_search_pages records the scrape attempt regardless of dedupe outcome.
--
-- RLS intentionally NOT enabled — same rationale as scrape_jobs above.

create table if not exists public.artist_search_pages (
  id                uuid        primary key default gen_random_uuid(),
  search_run_id     uuid        not null references public.artist_search_runs(id) on delete cascade,
  page_number       integer     not null,
  result_count      integer     not null default 0,
  source_url        text,
  scraped_at        timestamptz not null default now(),
  -- full raw API or HTML response metadata; kept for troubleshooting parser changes
  raw_metadata_json jsonb,
  constraint artist_search_pages_run_page_uidx
    unique (search_run_id, page_number)
);

-- the unique constraint above covers (search_run_id, page_number); a plain
-- index on just search_run_id ensures fast cascade-delete and FK lookups
create index if not exists artist_search_pages_search_run_id_idx
  on public.artist_search_pages (search_run_id);


-- ── FK: artist_search_runs.scrape_job_id → scrape_jobs(id) ──────────────────
--
-- The live schema export shows scrape_job_id already referencing scrape_jobs.
-- If this migration is applied to a fresh database where that FK was not yet
-- created (e.g., a local dev clone), this block adds it safely.
-- NOT VALID is used so that any existing rows with NULL scrape_job_id (the
-- column default) pass through without a full-table validation scan; a future
-- VALIDATE CONSTRAINT can be run at a convenient time.

do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints   tc
      join information_schema.key_column_usage    kcu
        on  tc.constraint_name = kcu.constraint_name
        and tc.table_schema    = kcu.table_schema
     where tc.table_schema    = 'public'
       and tc.table_name      = 'artist_search_runs'
       and tc.constraint_type = 'FOREIGN KEY'
       and kcu.column_name    = 'scrape_job_id'
  ) then
    alter table public.artist_search_runs
      add constraint artist_search_runs_scrape_job_id_fkey
      foreign key (scrape_job_id) references public.scrape_jobs(id)
      on delete set null
      not valid;
  end if;
end $$;


-- ── Composite unique on artist_set_results(source, source_tracklist_id) ──────
--
-- WHY: A scrape job for ILLENIUM may be retried after a partial failure, or
-- two search runs may return overlapping result pages. Without a composite
-- unique key, the same tracklist entry would be inserted multiple times.
-- ON CONFLICT (source, source_tracklist_id) DO UPDATE allows safe upserts.
--
-- The live schema export shows both columns individually marked is_unique=true,
-- which in Supabase's introspection format indicates membership in a unique
-- index (possibly composite). CREATE UNIQUE INDEX IF NOT EXISTS with this
-- specific name is a no-op if the index already exists; if a differently-named
-- composite already covers these columns, a harmless redundant index is added.
-- A separate source-only or source_tracklist_id-only unique index would be
-- architecturally incorrect (source alone would allow only one source in the
-- whole table), so the composite interpretation is assumed authoritative.

create unique index if not exists artist_set_results_source_tracklist_uidx
  on public.artist_set_results (source, source_tracklist_id);

commit;
