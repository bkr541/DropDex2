-- Derive artist links from the display credit without changing imported tracks.
create function public.rekordbox_artist_credit_names(p_credit text)
returns table (artist_key text, name text)
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  with credit as (
    select regexp_replace(
      regexp_replace(btrim(p_credit), '[[:space:]]+', ' ', 'g'),
      ' \((feat[.]?|ft[.]?|featuring) ([^()]*)\) *$',
      ' \1 \2',
      'i'
    ) as value
  ),
  names as (
    select btrim(part) as name
    from credit
    cross join lateral regexp_split_to_table(
      credit.value,
      ' *[,;] *| +([&+x×]|feat[.]?|ft[.]?|featuring|vs[.]?) +',
      'i'
    ) as parts(part)
  )
  select lower(names.name) as artist_key, min(names.name collate "C") as name
  from names
  where names.name <> ''
  group by lower(names.name)
$$;

revoke all on function public.rekordbox_artist_credit_names(text) from public;
grant execute on function public.rekordbox_artist_credit_names(text) to authenticated;

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
        and (
          v_artist is null
          or t.artist = v_artist
          or exists (
            select 1
            from public.rekordbox_artist_credit_names(t.artist) credit
            where credit.artist_key = lower(v_artist)
          )
        )
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
    artist_credits as (
      select artist, count(*)::integer as track_count
      from owned_tracks
      where artist is not null and btrim(artist) <> ''
      group by artist
    ),
    artists as (
      select min(credit.name collate "C") as name, sum(artist_credits.track_count)::integer as track_count
      from artist_credits
      cross join lateral public.rekordbox_artist_credit_names(artist_credits.artist) credit
      group by credit.artist_key
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
