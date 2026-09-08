-- Roulette Stage 3: canonical persistent derived stem assets.
-- Parent Rekordbox tracks remain the source of musical truth. This table owns
-- only derived file lifecycle/status metadata for vocals/instrumental assets.

create table if not exists public.roulette_stem_assets (
  id                  uuid        primary key default gen_random_uuid(),
  track_id            uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  stem_type           text        not null,
  status              text        not null default 'pending',
  storage_locator     text,
  source_fingerprint  text        not null,
  separator_version   text,
  contract_version    integer     not null default 1,
  duration_ms         bigint,
  sample_rate_hz      integer,
  channel_count       integer,
  file_size_bytes     bigint,
  file_mtime_ms       double precision,
  failure_code        text,
  failure_message     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint roulette_stem_assets_track_type_unique unique (track_id, stem_type),
  constraint roulette_stem_assets_stem_type_check
    check (stem_type in ('vocals', 'instrumental')),
  constraint roulette_stem_assets_status_check
    check (status in ('pending', 'processing', 'ready', 'failed')),
  constraint roulette_stem_assets_contract_version_check
    check (contract_version > 0),
  constraint roulette_stem_assets_duration_check
    check (duration_ms is null or duration_ms >= 0),
  constraint roulette_stem_assets_sample_rate_check
    check (sample_rate_hz is null or sample_rate_hz > 0),
  constraint roulette_stem_assets_channel_count_check
    check (channel_count is null or channel_count > 0),
  constraint roulette_stem_assets_file_size_check
    check (file_size_bytes is null or file_size_bytes >= 0),
  constraint roulette_stem_assets_ready_metadata_check
    check (
      status <> 'ready'
      or (
        storage_locator is not null
        and length(btrim(storage_locator)) > 0
        and separator_version is not null
        and length(btrim(separator_version)) > 0
      )
    )
);

create index if not exists roulette_stem_assets_track_id_idx
  on public.roulette_stem_assets (track_id);
create index if not exists roulette_stem_assets_status_idx
  on public.roulette_stem_assets (status);

alter table public.roulette_stem_assets enable row level security;

drop policy if exists "Users can select their own Roulette stem assets"
  on public.roulette_stem_assets;
create policy "Users can select their own Roulette stem assets"
  on public.roulette_stem_assets for select
  to authenticated
  using (
    exists (
      select 1
        from public.rekordbox_tracks
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_tracks.import_id
       where rekordbox_tracks.id = roulette_stem_assets.track_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert their own Roulette stem assets"
  on public.roulette_stem_assets;
create policy "Users can insert their own Roulette stem assets"
  on public.roulette_stem_assets for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.rekordbox_tracks
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_tracks.import_id
       where rekordbox_tracks.id = roulette_stem_assets.track_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update their own Roulette stem assets"
  on public.roulette_stem_assets;
create policy "Users can update their own Roulette stem assets"
  on public.roulette_stem_assets for update
  to authenticated
  using (
    exists (
      select 1
        from public.rekordbox_tracks
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_tracks.import_id
       where rekordbox_tracks.id = roulette_stem_assets.track_id
         and rekordbox_imports.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
        from public.rekordbox_tracks
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_tracks.import_id
       where rekordbox_tracks.id = roulette_stem_assets.track_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own Roulette stem assets"
  on public.roulette_stem_assets;
create policy "Users can delete their own Roulette stem assets"
  on public.roulette_stem_assets for delete
  to authenticated
  using (
    exists (
      select 1
        from public.rekordbox_tracks
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_tracks.import_id
       where rekordbox_tracks.id = roulette_stem_assets.track_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

drop trigger if exists roulette_stem_assets_updated_at on public.roulette_stem_assets;
create trigger roulette_stem_assets_updated_at
before update on public.roulette_stem_assets
for each row execute function public.set_updated_at();
