-- Add per-track manifest_status column for incremental rescan tracking
alter table public.rekordbox_analysis_assets
  add column if not exists blob_id uuid
    references public.rekordbox_analysis_blobs(id) on delete set null;

create index if not exists rekordbox_analysis_assets_blob_id_idx
  on public.rekordbox_analysis_assets (blob_id)
  where blob_id is not null;
