-- ============================================================
-- DropDex: Add normalized musical-key columns to rekordbox_tracks
--
-- musical_key (the original Rekordbox value) is preserved unchanged.
-- The four new columns are derived at import time by music_keys.py
-- and remain NULL for tracks whose key was not recognised.
--
-- Backfill existing rows with:
--   cd importer && python backfill_keys.py
-- ============================================================

alter table public.rekordbox_tracks
  add column if not exists camelot_key         text,
  add column if not exists normalized_key_name text,
  add column if not exists key_tonic           text,
  add column if not exists key_mode            text;

-- camelot_key must be null or a valid Camelot wheel position (1A–12B)
alter table public.rekordbox_tracks
  add constraint rekordbox_tracks_camelot_key_check
    check (camelot_key is null or camelot_key ~ '^(1[0-2]|[1-9])[AB]$');

-- key_mode must be null, 'major', or 'minor'
alter table public.rekordbox_tracks
  add constraint rekordbox_tracks_key_mode_check
    check (key_mode is null or key_mode in ('major', 'minor'));

-- Composite index: filters by Camelot key within an import (e.g. "show all 8A tracks")
create index if not exists rekordbox_tracks_import_camelot_idx
  on public.rekordbox_tracks (import_id, camelot_key);
