-- ============================================================
-- DropDex: Allow 'partial' parse_status on analysis assets
--
-- The first migration omitted 'partial' from the
-- rekordbox_analysis_assets.parse_status CHECK constraint.
-- ANLZ parser produces completed | partial | failed; we must
-- persist 'partial' accurately rather than converting it to
-- 'completed' or failing the constraint entirely.
--
-- This migration:
--   1. Drops the old constraint on rekordbox_analysis_assets
--   2. Re-creates it with 'partial' included
-- ============================================================

alter table public.rekordbox_analysis_assets
  drop constraint if exists rekordbox_analysis_assets_parse_status_check;

alter table public.rekordbox_analysis_assets
  add constraint rekordbox_analysis_assets_parse_status_check
    check (parse_status in (
      'not_requested', 'queued', 'parsing',
      'completed', 'partial', 'failed', 'skipped'
    ));
