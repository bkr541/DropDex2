-- reset_invalid_completed_scrapes.sql
--
-- Purpose:
--   Reset artist_set_results rows that are stuck in a "completed" state with
--   zero parsed tracks even though the setlist metadata reports a non-zero
--   expected track count.  These records were created before the zero-track
--   failure guard was added to run_setlist_detail_scrape.
--
-- Effect:
--   Resets status to 'not_scraped' so the frontend auto-scrape fires the next
--   time a user views the setlist.  The backend will then either successfully
--   parse tracks or correctly mark the record as 'failed'.
--
-- Safe to run:
--   - Read-only rows (source URL, setlist metadata) are not affected.
--   - Saved track rows in artist_set_tracks are not touched; they should already
--     be empty for these records (parsed_track_count = 0).
--   - Idempotent: running more than once has no additional effect.
--
-- When to run:
--   Run once after deploying the zero-track failure guard fix.  You can target
--   a specific artist with the optional WHERE clause below.
--
-- Preview (dry-run) first:
--
--   SELECT id, title, detail_scrape_status, parsed_track_count, total_tracks
--   FROM public.artist_set_results
--   WHERE detail_scrape_status = 'completed'
--     AND coalesce(parsed_track_count, 0) = 0
--     AND coalesce(total_tracks, 0) > 0;

UPDATE public.artist_set_results
SET
    detail_scrape_status = 'not_scraped',
    detail_scraped_at    = NULL,
    parsed_track_count   = NULL,
    detail_scrape_error  = NULL
WHERE
    detail_scrape_status = 'completed'
    AND coalesce(parsed_track_count, 0) = 0
    AND coalesce(total_tracks, 0) > 0;
