-- Replace delete_rekordbox_import_children_v1 with a version that declares
-- statement_timeout = 0 at the function-definition level.  This is more
-- reliable than SET LOCAL inside the body because PostgreSQL applies the
-- function-level GUC before PostgREST's pooler timeout can interfere.

begin;

create or replace function public.delete_rekordbox_import_children_v1(
  p_import_id uuid,
  p_user_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = 0
as $$
begin
  if not exists (
    select 1
      from public.rekordbox_imports
     where id      = p_import_id
       and user_id = p_user_id
  ) then
    raise exception 'Import not found or access denied';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'rekordbox_analysis_asset_references'
       and c.relkind = 'r'
  ) then
    delete from public.rekordbox_analysis_asset_references
     where import_id = p_import_id;
  end if;

  delete from public.rekordbox_track_beat_grids     where import_id = p_import_id;
  delete from public.rekordbox_track_waveforms       where import_id = p_import_id;
  delete from public.rekordbox_track_phrases         where import_id = p_import_id;
  delete from public.rekordbox_cues                  where import_id = p_import_id;
  delete from public.rekordbox_recommendation_edges  where import_id = p_import_id;
  delete from public.rekordbox_related_track_lists   where import_id = p_import_id;
  delete from public.rekordbox_analysis_assets       where import_id = p_import_id;
  delete from public.rekordbox_playlists             where import_id = p_import_id;
  delete from public.rekordbox_tracks                where import_id = p_import_id;
end;
$$;

revoke all on function public.delete_rekordbox_import_children_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_rekordbox_import_children_v1(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
