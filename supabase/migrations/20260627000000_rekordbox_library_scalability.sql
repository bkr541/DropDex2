-- ============================================================
-- DropDex: scalable library / playlist browsing and statistics
--
-- All functions are SECURITY INVOKER and also perform an explicit ownership
-- check. That keeps RLS authoritative while ensuring an unauthorized import or
-- playlist ID fails instead of returning a misleading empty aggregate.
-- ============================================================

create index if not exists rekordbox_tracks_import_date_added_id_idx
  on public.rekordbox_tracks (import_id, date_added desc, id asc);

create or replace function public.get_rekordbox_playlists_with_counts(
  p_import_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.rekordbox_imports i
    where i.id = p_import_id
      and i.user_id = auth.uid()
  ) then
    raise exception 'Not authorized to read this Rekordbox import'
      using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(p) || jsonb_build_object(
        'track_count', (
          select count(*)::integer
          from public.rekordbox_playlist_tracks pt
          where pt.playlist_id = p.id
        )
      )
      order by p.sort_order asc nulls last, p.id asc
    )
    from public.rekordbox_playlists p
    where p.import_id = p_import_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_rekordbox_library_track_page(
  p_import_id uuid,
  p_offset integer default 0,
  p_limit integer default 200,
  p_search text default null,
  p_genre text default null,
  p_artist text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_search text := nullif(btrim(p_search), '');
  v_genre text := nullif(btrim(p_genre), '');
  v_artist text := nullif(btrim(p_artist), '');
begin
  if auth.uid() is null or not exists (
    select 1
    from public.rekordbox_imports i
    where i.id = p_import_id
      and i.user_id = auth.uid()
  ) then
    raise exception 'Not authorized to read this Rekordbox import'
      using errcode = '42501';
  end if;

  return (
    with filtered as materialized (
      select t.*
      from public.rekordbox_tracks t
      where t.import_id = p_import_id
        and (
          v_search is null
          or t.title ilike '%' || v_search || '%'
          or t.artist ilike '%' || v_search || '%'
          or t.genre ilike '%' || v_search || '%'
        )
        and (v_genre is null or t.genre = v_genre)
        and (v_artist is null or t.artist = v_artist)
    ),
    paged as (
      select f.*
      from filtered f
      order by f.date_added desc nulls last, f.id asc
      offset v_offset
      limit v_limit
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.date_added desc nulls last, p.id asc)
        from paged p
      ), '[]'::jsonb),
      'total', (select count(*)::integer from filtered),
      'offset', v_offset,
      'limit', v_limit
    )
  );
end;
$$;

create or replace function public.get_rekordbox_playlist_track_page(
  p_playlist_id uuid,
  p_offset integer default 0,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if auth.uid() is null or not exists (
    select 1
    from public.rekordbox_playlists p
    join public.rekordbox_imports i on i.id = p.import_id
    where p.id = p_playlist_id
      and i.user_id = auth.uid()
  ) then
    raise exception 'Not authorized to read this Rekordbox playlist'
      using errcode = '42501';
  end if;

  return (
    with placements as materialized (
      select pt.position, t
      from public.rekordbox_playlist_tracks pt
      join public.rekordbox_playlists playlist on playlist.id = pt.playlist_id
      join public.rekordbox_tracks t
        on t.id = pt.track_id
       and t.import_id = playlist.import_id
      where playlist.id = p_playlist_id
    ),
    paged as (
      select p.position, p.t
      from placements p
      order by p.position asc
      offset v_offset
      limit v_limit
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object('position', p.position, 'track', to_jsonb(p.t))
          order by p.position asc
        )
        from paged p
      ), '[]'::jsonb),
      'total', (select count(*)::integer from placements),
      'offset', v_offset,
      'limit', v_limit
    )
  );
end;
$$;

create or replace function public.get_rekordbox_library_stats(
  p_import_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.rekordbox_imports i
    where i.id = p_import_id
      and i.user_id = auth.uid()
  ) then
    raise exception 'Not authorized to read this Rekordbox import'
      using errcode = '42501';
  end if;

  return (
    with owned_tracks as materialized (
      select t.*
      from public.rekordbox_tracks t
      where t.import_id = p_import_id
    ),
    genres as (
      select genre as name, count(*)::integer as track_count
      from owned_tracks
      where genre is not null and btrim(genre) <> ''
      group by genre
    ),
    artists as (
      select artist as name, count(*)::integer as track_count
      from owned_tracks
      where artist is not null and btrim(artist) <> ''
      group by artist
    ),
    bpms as (
      select round(bpm)::integer as bpm_value, count(*)::integer as track_count
      from owned_tracks
      where bpm is not null and bpm > 0
      group by round(bpm)::integer
    ),
    keys as (
      select musical_key as name, count(*)::integer as track_count
      from owned_tracks
      where musical_key is not null and btrim(musical_key) <> ''
      group by musical_key
    )
    select jsonb_build_object(
      'total_track_count', (select count(*)::integer from owned_tracks),
      'total_duration_seconds', coalesce((select sum(coalesce(duration_seconds, 0))::bigint from owned_tracks), 0),
      'average_bpm', (select round(avg(bpm)::numeric, 2) from owned_tracks where bpm is not null and bpm > 0),
      'most_common_bpm', (
        select bpm_value from bpms order by track_count desc, bpm_value asc limit 1
      ),
      'most_common_key', (
        select name from keys order by track_count desc, name asc limit 1
      ),
      'genre_totals', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'count', track_count) order by track_count desc, name asc)
        from genres
      ), '[]'::jsonb),
      'artist_totals', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'count', track_count) order by track_count desc, name asc)
        from artists
      ), '[]'::jsonb),
      'bpm_totals', coalesce((
        select jsonb_agg(jsonb_build_object('bpm', bpm_value, 'count', track_count) order by track_count desc, bpm_value asc)
        from bpms
      ), '[]'::jsonb),
      'key_totals', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'count', track_count) order by track_count desc, name asc)
        from keys
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_rekordbox_playlist_stats(
  p_playlist_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.rekordbox_playlists p
    join public.rekordbox_imports i on i.id = p.import_id
    where p.id = p_playlist_id
      and i.user_id = auth.uid()
  ) then
    raise exception 'Not authorized to read this Rekordbox playlist'
      using errcode = '42501';
  end if;

  return (
    with placements as materialized (
      select pt.position, t.duration_seconds, t.bpm, t.musical_key
      from public.rekordbox_playlist_tracks pt
      join public.rekordbox_playlists playlist on playlist.id = pt.playlist_id
      join public.rekordbox_tracks t
        on t.id = pt.track_id
       and t.import_id = playlist.import_id
      where playlist.id = p_playlist_id
    ),
    keys as (
      select musical_key as name, count(*)::integer as track_count
      from placements
      where musical_key is not null and btrim(musical_key) <> ''
      group by musical_key
    )
    select jsonb_build_object(
      'track_count', (select count(*)::integer from placements),
      'total_duration_seconds', coalesce((select sum(coalesce(duration_seconds, 0))::bigint from placements), 0),
      'average_bpm', (select round(avg(bpm)::numeric, 2) from placements where bpm is not null and bpm > 0),
      'most_common_key', (
        select name from keys order by track_count desc, name asc limit 1
      )
    )
  );
end;
$$;

revoke all on function public.get_rekordbox_playlists_with_counts(uuid) from public;
revoke all on function public.get_rekordbox_library_track_page(uuid, integer, integer, text, text, text) from public;
revoke all on function public.get_rekordbox_playlist_track_page(uuid, integer, integer) from public;
revoke all on function public.get_rekordbox_library_stats(uuid) from public;
revoke all on function public.get_rekordbox_playlist_stats(uuid) from public;

grant execute on function public.get_rekordbox_playlists_with_counts(uuid) to authenticated;
grant execute on function public.get_rekordbox_library_track_page(uuid, integer, integer, text, text, text) to authenticated;
grant execute on function public.get_rekordbox_playlist_track_page(uuid, integer, integer) to authenticated;
grant execute on function public.get_rekordbox_library_stats(uuid) to authenticated;
grant execute on function public.get_rekordbox_playlist_stats(uuid) to authenticated;
