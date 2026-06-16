-- ============================================================
-- DropDex: Content-addressed raw ANLZ asset storage
--
-- Same-user imports that upload identical ANLZ files (same SHA-256
-- and size) now share one Storage object.  Different users' blobs
-- are never shared — each blob belongs to the user who created it.
--
-- Deleting a rekordbox_import cascade-deletes its asset_references.
-- The blob itself is deleted only when it has no remaining references
-- (enforced by application logic, not FK; Storage cleanup runs after
-- the reference row is gone).
-- ============================================================

create table if not exists public.rekordbox_analysis_blobs (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  sha256         text        not null,
  size_bytes     bigint      not null,
  storage_bucket text        not null default 'rekordbox-analysis-assets',
  storage_path   text        not null,
  mime_type      text        not null default 'application/octet-stream',
  created_at     timestamptz not null default now(),
  constraint rekordbox_analysis_blobs_user_sha_size_unique
    unique (user_id, sha256, size_bytes)
);

-- Blob ownership check: only the owning user may read blob metadata.
alter table public.rekordbox_analysis_blobs enable row level security;
drop policy if exists "Users can select their own blobs" on public.rekordbox_analysis_blobs;
create policy "Users can select their own blobs"
  on public.rekordbox_analysis_blobs for select
  to authenticated
  using (user_id = auth.uid());

create index if not exists rekordbox_analysis_blobs_user_sha_idx
  on public.rekordbox_analysis_blobs (user_id, sha256);

-- Reference table: links imports/tracks to blobs
create table if not exists public.rekordbox_analysis_asset_references (
  id               uuid        primary key default gen_random_uuid(),
  blob_id          uuid        not null references public.rekordbox_analysis_blobs(id) on delete restrict,
  analysis_asset_id uuid       references public.rekordbox_analysis_assets(id) on delete cascade,
  import_id        uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id         uuid        references public.rekordbox_tracks(id) on delete cascade,
  created_at       timestamptz not null default now()
);

alter table public.rekordbox_analysis_asset_references enable row level security;
drop policy if exists "Users can select their own asset references" on public.rekordbox_analysis_asset_references;
create policy "Users can select their own asset references"
  on public.rekordbox_analysis_asset_references for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports i
       where i.id = import_id and i.user_id = auth.uid()
    )
  );

create index if not exists rekordbox_analysis_asset_references_blob_idx
  on public.rekordbox_analysis_asset_references (blob_id);
create index if not exists rekordbox_analysis_asset_references_import_idx
  on public.rekordbox_analysis_asset_references (import_id);
create index if not exists rekordbox_analysis_asset_references_track_idx
  on public.rekordbox_analysis_asset_references (track_id)
  where track_id is not null;
