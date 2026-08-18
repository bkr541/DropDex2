-- Extend get_rekordbox_playlists_with_counts to include top_genres per playlist.
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
        ),
        'top_genres', coalesce((
          select jsonb_agg(name order by cnt desc, name asc)
          from (
            select t.genre as name, count(*) as cnt
            from public.rekordbox_playlist_tracks pt
            join public.rekordbox_tracks t on t.id = pt.track_id
            where pt.playlist_id = p.id
              and t.genre is not null
              and btrim(t.genre) <> ''
            group by t.genre
            order by cnt desc, t.genre asc
            limit 10
          ) genre_counts
        ), '[]'::jsonb)
      )
      order by p.sort_order asc nulls last, p.id asc
    )
    from public.rekordbox_playlists p
    where p.import_id = p_import_id
  ), '[]'::jsonb);
end;
$$;
