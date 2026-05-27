-- ============================================================================
-- DropDex Migration 1 of 2
-- Adds the genre catalog and artist-to-genre junction table.
--
-- Prerequisite:
--   public.artists already exists in the deployed 1001Tracklists schema.
--   Its primary key is UUID and is already referenced by the setlist tables.
--
-- Deliberately unchanged:
--   public.artists and all public.rekordbox_* tables.
--
-- Access model:
--   RLS is not enabled here because the supplied live schema export shows the
--   existing shared discovery tables with RLS disabled. Apply RLS to the whole
--   shared discovery surface together if that policy changes.
-- ============================================================================

begin;

create or replace function public.dropdex_normalize_genre(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(
    regexp_replace(
      regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', ' ', 'g'),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

create table if not exists public.genres (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  normalized_name text        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists genres_normalized_name_uidx
  on public.genres (normalized_name);

create index if not exists genres_name_idx
  on public.genres (name);

create table if not exists public.artist_genres (
  artist_id  uuid        not null references public.artists(id) on delete cascade,
  genre_id   uuid        not null references public.genres(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (artist_id, genre_id)
);

create index if not exists artist_genres_genre_id_idx
  on public.artist_genres (genre_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_genres_updated_at on public.genres;
create trigger trg_genres_updated_at
before update on public.genres
for each row execute function public.set_updated_at();

commit;
