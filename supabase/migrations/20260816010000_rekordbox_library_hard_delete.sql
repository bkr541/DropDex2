-- DropDex Rekordbox library hard-delete semantics.
-- A completed destructive cleanup now removes the import parent row itself and
-- atomically repairs the user's active-library selection.

begin;

alter table public.rekordbox_imports
  add column if not exists delete_active_strategy text;

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_delete_active_strategy_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_delete_active_strategy_check check (
    delete_active_strategy is null
    or delete_active_strategy in ('activate_next', 'start_over')
  );

-- Browser callers may only activate snapshots that the product considers a
-- usable library. Failed/cancelled/in-flight imports are not valid targets.
create or replace function public.set_active_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
      from public.rekordbox_imports
     where id = p_import_id
       and user_id = v_user_id
       and status in ('completed', 'paused', 'interrupted')
  ) then
    raise exception 'Import is not a usable library snapshot or access was denied';
  end if;

  insert into public.rekordbox_user_settings (user_id, active_import_id, updated_at)
  values (v_user_id, p_import_id, now())
  on conflict (user_id) do update
    set active_import_id = excluded.active_import_id,
        updated_at = excluded.updated_at;
end;
$$;

-- Service-role-only finalization step. Cloud/staging cleanup happens in the API
-- first. This function then performs the parent-row delete and active-library
-- repair in one database transaction so the app cannot be left pointing at a
-- deleted snapshot.
create or replace function public.hard_delete_rekordbox_import(
  p_import_id uuid,
  p_user_id uuid,
  p_active_strategy text default 'activate_next'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings_exists boolean := false;
  v_effective_active uuid;
  v_next_active uuid;
begin
  if p_active_strategy not in ('activate_next', 'start_over') then
    raise exception 'Invalid delete active strategy';
  end if;

  -- Serialize destructive library selection changes for one user.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (
    select 1
      from public.rekordbox_imports
     where id = p_import_id
       and user_id = p_user_id
  ) then
    raise exception 'Import not found';
  end if;

  select active_import_id
    into v_effective_active
    from public.rekordbox_user_settings
   where user_id = p_user_id;
  v_settings_exists := found;

  -- Users created before the settings row existed implicitly use the newest
  -- usable snapshot. Preserve that behavior when deciding whether the target is
  -- effectively active.
  if not v_settings_exists then
    select id
      into v_effective_active
      from public.rekordbox_imports
     where user_id = p_user_id
       and status in ('completed', 'paused', 'interrupted')
     order by imported_at desc, id desc
     limit 1;
  end if;

  delete from public.rekordbox_imports
   where id = p_import_id
     and user_id = p_user_id;

  if v_effective_active is distinct from p_import_id then
    return v_effective_active;
  end if;

  if p_active_strategy = 'activate_next' then
    select id
      into v_next_active
      from public.rekordbox_imports
     where user_id = p_user_id
       and status in ('completed', 'paused', 'interrupted')
     order by imported_at desc, id desc
     limit 1;
  else
    v_next_active := null;
  end if;

  insert into public.rekordbox_user_settings (user_id, active_import_id, updated_at)
  values (p_user_id, v_next_active, now())
  on conflict (user_id) do update
    set active_import_id = excluded.active_import_id,
        updated_at = excluded.updated_at;

  return v_next_active;
end;
$$;

revoke all on function public.hard_delete_rekordbox_import(uuid, uuid, text) from public;
revoke all on function public.hard_delete_rekordbox_import(uuid, uuid, text) from anon;
revoke all on function public.hard_delete_rekordbox_import(uuid, uuid, text) from authenticated;
grant execute on function public.hard_delete_rekordbox_import(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
