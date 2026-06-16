-- Indexes for incremental rescan track matching
-- master_db_id + master_content_id is the primary stable identity
create index if not exists rekordbox_tracks_master_db_id_idx
  on public.rekordbox_tracks (master_db_id)
  where master_db_id is not null;

create index if not exists rekordbox_tracks_master_content_id_idx
  on public.rekordbox_tracks (master_content_id)
  where master_content_id is not null;

-- Compound index for the primary rescan lookup:
-- previous_import.master_db_id = new.master_db_id
-- AND previous_import.master_content_id = new.master_content_id
create index if not exists rekordbox_tracks_identity_compound_idx
  on public.rekordbox_tracks (master_db_id, master_content_id)
  where master_db_id is not null and master_content_id is not null;
