-- ============================================================
-- DropDex: Initial rekordbox schema
-- Creates four private per-user tables and RLS policies.
-- Safe to run on a fresh Supabase project.
-- ============================================================

-- ── A. rekordbox_imports ─────────────────────────────────────────
-- One row per USB library snapshot imported by a user.

create table if not exists public.rekordbox_imports (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users(id) on delete cascade,
  source_filename         text        not null,
  source_type             text        not null default 'onelibrary',
  database_version        text,
  device_name             text,
  rekordbox_created_date  date,
  track_count             integer     not null default 0,
  playlist_count          integer     not null default 0,
  playlist_track_count    integer     not null default 0,
  status                  text        not null default 'processing',
  error_message           text,
  imported_at             timestamptz not null default now(),
  constraint rekordbox_imports_status_check
    check (status in ('processing', 'completed', 'failed'))
);

-- ── B. rekordbox_tracks ──────────────────────────────────────────
-- Track metadata for one library snapshot.

create table if not exists public.rekordbox_tracks (
  id                      uuid        primary key default gen_random_uuid(),
  import_id               uuid        not null references public.rekordbox_imports(id) on delete cascade,
  rekordbox_content_id    text        not null,
  title                   text        not null,
  artist                  text,
  album                   text,
  remixer                 text,
  genre                   text,
  label                   text,
  musical_key             text,
  bpm                     numeric(7,2),
  duration_seconds        integer,
  rating                  integer,
  comments                text,
  file_path               text,
  file_format             text,
  date_added              date,
  created_at              timestamptz not null default now(),
  constraint rekordbox_tracks_unique_content
    unique (import_id, rekordbox_content_id)
);

create index if not exists rekordbox_tracks_import_id_idx on public.rekordbox_tracks (import_id);
create index if not exists rekordbox_tracks_title_idx      on public.rekordbox_tracks (title);
create index if not exists rekordbox_tracks_artist_idx     on public.rekordbox_tracks (artist);

-- ── C. rekordbox_playlists ───────────────────────────────────────
-- Playlist tree (supports optional folder hierarchy via self-ref FK).

create table if not exists public.rekordbox_playlists (
  id                      uuid        primary key default gen_random_uuid(),
  import_id               uuid        not null references public.rekordbox_imports(id) on delete cascade,
  rekordbox_playlist_id   text        not null,
  name                    text        not null,
  parent_playlist_id      uuid        references public.rekordbox_playlists(id) on delete cascade,
  sort_order              integer,
  is_folder               boolean     not null default false,
  created_at              timestamptz not null default now(),
  constraint rekordbox_playlists_unique_playlist
    unique (import_id, rekordbox_playlist_id)
);

create index if not exists rekordbox_playlists_import_id_idx  on public.rekordbox_playlists (import_id);
create index if not exists rekordbox_playlists_parent_id_idx  on public.rekordbox_playlists (parent_playlist_id);

-- ── D. rekordbox_playlist_tracks ─────────────────────────────────
-- Ordered track placement inside playlists.

create table if not exists public.rekordbox_playlist_tracks (
  playlist_id  uuid        not null references public.rekordbox_playlists(id) on delete cascade,
  track_id     uuid        not null references public.rekordbox_tracks(id)    on delete cascade,
  position     integer     not null,
  created_at   timestamptz not null default now(),
  constraint rekordbox_playlist_tracks_pkey
    primary key (playlist_id, position),
  constraint rekordbox_playlist_tracks_unique_placement
    unique (playlist_id, track_id, position)
);

create index if not exists rekordbox_playlist_tracks_playlist_pos_idx
  on public.rekordbox_playlist_tracks (playlist_id, position);
create index if not exists rekordbox_playlist_tracks_track_id_idx
  on public.rekordbox_playlist_tracks (track_id);

-- ── Row Level Security ───────────────────────────────────────────

alter table public.rekordbox_imports        enable row level security;
alter table public.rekordbox_tracks         enable row level security;
alter table public.rekordbox_playlists      enable row level security;
alter table public.rekordbox_playlist_tracks enable row level security;

-- rekordbox_imports policies

create policy "Users can select their own imports"
  on public.rekordbox_imports for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can delete their own imports"
  on public.rekordbox_imports for delete
  to authenticated
  using (user_id = auth.uid());

-- rekordbox_tracks policies

create policy "Users can select tracks from their own imports"
  on public.rekordbox_tracks for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_tracks.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

create policy "Users can delete tracks from their own imports"
  on public.rekordbox_tracks for delete
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_tracks.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- rekordbox_playlists policies

create policy "Users can select playlists from their own imports"
  on public.rekordbox_playlists for select
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_playlists.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

create policy "Users can delete playlists from their own imports"
  on public.rekordbox_playlists for delete
  to authenticated
  using (
    exists (
      select 1 from public.rekordbox_imports
       where rekordbox_imports.id      = rekordbox_playlists.import_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

-- rekordbox_playlist_tracks policies

create policy "Users can select playlist tracks from their own imports"
  on public.rekordbox_playlist_tracks for select
  to authenticated
  using (
    exists (
      select 1
        from public.rekordbox_playlists
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_playlists.import_id
       where rekordbox_playlists.id      = rekordbox_playlist_tracks.playlist_id
         and rekordbox_imports.user_id   = auth.uid()
    )
  );

create policy "Users can delete playlist tracks from their own imports"
  on public.rekordbox_playlist_tracks for delete
  to authenticated
  using (
    exists (
      select 1
        from public.rekordbox_playlists
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_playlists.import_id
       where rekordbox_playlists.id      = rekordbox_playlist_tracks.playlist_id
         and rekordbox_imports.user_id   = auth.uid()
    )
  );
