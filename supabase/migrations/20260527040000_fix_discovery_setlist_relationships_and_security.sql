-- ============================================================================
-- DropDex Migration: Fix discovery setlist relationships and security
--
-- SUMMARY OF CHANGES
-- ──────────────────
-- 1. Add unique constraint on artist_set_result_artists(set_result_id, artist_id)
--    so that link_result_to_artist can safely upsert with ON CONFLICT DO NOTHING.
--
-- 2. Add covering indexes for efficient artist-setlist retrieval via the
--    junction table.
--
-- 3. Enable RLS on public.scrape_jobs.
--    The backend uses the service-role key (bypasses RLS) for all DB writes.
--    The browser frontend does not query scrape_jobs directly; all job access
--    goes through authenticated FastAPI endpoints.  No permissive anonymous
--    or authenticated-role policies are added — service-role access bypasses
--    RLS by PostgreSQL design.
--
-- BACKGROUND: THE COLLABORATIVE-SET BUG
-- ──────────────────────────────────────
-- The previous architecture stored a single artist_id column on
-- artist_set_results and filtered retrieval on that column.  When the same
-- (source, source_tracklist_id) was discovered for a second artist, the upsert
-- overwrote artist_id, silently breaking retrieval for the first artist.
--
-- The fix:
--   • artist_set_results.artist_id is PROVENANCE ONLY (the first artist whose
--     scrape created the row).  It must NEVER be overwritten on conflict.
--   • artist_set_result_artists is the AUTHORITATIVE many-to-many relationship.
--     All artist-setlist retrieval must JOIN/filter through this table.
--
-- This migration does not remove artist_set_results.artist_id to preserve
-- backwards compatibility with any existing queries or analytics.
--
-- IDEMPOTENCY
-- ───────────
-- Every statement uses IF NOT EXISTS / guarded DO blocks.  Safe to re-apply.
-- ============================================================================

begin;

-- ── 1. Unique constraint on artist_set_result_artists(set_result_id, artist_id) ──
--
-- Without this constraint, repeated scrape jobs could insert duplicate junction
-- rows.  The repository's link_result_to_artist previously used a
-- select-then-insert guard (two round trips).  With this index it can use a
-- single upsert with ON CONFLICT (set_result_id, artist_id) DO NOTHING,
-- guaranteeing idempotency in one round trip.
--
-- AUTHORITATIVE RELATIONSHIP: artist_set_result_artists is the source of truth
-- for which artists are associated with which setlist results.  Querying an
-- artist's setlists must filter on artist_set_result_artists.artist_id, not on
-- the provenance column artist_set_results.artist_id.

create unique index if not exists artist_set_result_artists_set_result_artist_uidx
  on public.artist_set_result_artists (set_result_id, artist_id);


-- ── 2. Supporting indexes ─────────────────────────────────────────────────────

-- Fast lookup: "give me all set_result_ids for this artist"
-- Already covered by the unique index above (composite, artist_id is second
-- column), but a standalone index ensures the planner can use index-only scans
-- when filtering only on artist_id.
create index if not exists artist_set_result_artists_artist_id_idx
  on public.artist_set_result_artists (artist_id);

-- Fast FK lookup: "give me all junction rows for this result" (cascade deletes)
create index if not exists artist_set_result_artists_set_result_id_idx
  on public.artist_set_result_artists (set_result_id);

-- Deduplication key index (may already exist from migration 000000 or 030000)
create unique index if not exists artist_set_results_source_tracklist_uidx
  on public.artist_set_results (source, source_tracklist_id);

-- Ordering index for set_date DESC NULLS LAST (the standard sort for setlists)
create index if not exists artist_set_results_set_date_idx
  on public.artist_set_results (set_date desc nulls last);


-- ── 3. Enable RLS on public.scrape_jobs ───────────────────────────────────────
--
-- scrape_jobs contains user-linked data:
--   • requested_by_user_id  (Supabase auth user)
--   • artist_id             (selected artist)
--   • status / error_message / timestamps (operational state)
--
-- Access model after RLS is enabled:
--   • Backend (service-role key):  bypasses RLS — all existing writes/reads
--     continue to work without any policy changes.
--   • Browser frontend (anon/authenticated key):  denied by default — no
--     direct table access is needed because the app uses FastAPI endpoints
--     for all scrape-job operations.
--
-- No permissive policies are added.  The backend's ownership check
-- (get_job_summary_for_user filters on requested_by_user_id) is an
-- application-layer guard, not a DB-level RLS policy — and that is correct
-- because service-role access already bypasses RLS.
--
-- If a future client-side polling pattern is added, an authenticated-role
-- policy such as:
--   CREATE POLICY "users can read own jobs"
--     ON public.scrape_jobs FOR SELECT
--     USING (requested_by_user_id = auth.uid());
-- should be introduced at that time.

alter table public.scrape_jobs enable row level security;


-- ── 4. Comment documenting the authoritative relationship ─────────────────────

comment on table public.artist_set_result_artists is
  'AUTHORITATIVE artist ↔ setlist junction.  '
  'Always query an artist''s setlists by filtering on this table''s artist_id '
  'and joining to artist_set_results — never filter on '
  'artist_set_results.artist_id (provenance/legacy column only).';

comment on column public.artist_set_results.artist_id is
  'PROVENANCE ONLY — the first artist whose scrape created this shared result '
  'row.  Do not overwrite on conflict.  Do not use for artist-setlist retrieval; '
  'use artist_set_result_artists.artist_id instead.';

commit;
