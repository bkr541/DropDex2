-- ============================================================
-- DropDex: Per-track feature-level analysis status
--
-- Adds analysis_feature_statuses JSONB column to rekordbox_tracks.
-- Structure: { beat_grid, waveform, cues, phrases }
-- Each value: "completed" | "partial" | "failed" | "skipped"
--
-- Safe on an existing database (ADD COLUMN IF NOT EXISTS).
-- ============================================================

alter table public.rekordbox_tracks
  add column if not exists analysis_feature_statuses jsonb not null default '{}'::jsonb;

comment on column public.rekordbox_tracks.analysis_feature_statuses is
  'Per-feature parse results. Keys: beat_grid, waveform, cues, phrases. '
  'Values: completed | partial | failed | skipped.';
