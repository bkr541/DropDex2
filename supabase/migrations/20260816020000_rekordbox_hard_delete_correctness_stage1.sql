-- DropDex Rekordbox hard-delete correctness, Stage 1.
--
-- 1. Define one library-ready predicate for activation/fallback.
-- 2. Persist unresolved cross-import retained-analysis dependencies.
-- 3. Serialize dependency registration with destructive delete start.
-- 4. Keep source rows protected by ON DELETE RESTRICT until materialization.

begin;

create or replace function public.rekordbox_import_is_library_usable(
  p_status text,
  p_library_ready_at timestamptz
)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select p_library_ready_at is not null
     and p_status in ('completed', 'paused', 'interrupted');
$$;

revoke all on function public.rekordbox_import_is_library_usable(text, timestamptz)
  from public, anon, authenticated;

create table if not exists public.rekordbox_retained_analysis_dependencies (
  id                  uuid primary key default gen_random_uuid(),
  source_import_id    uuid not null references public.rekordbox_imports(id) on delete restrict,
  dependent_import_id uuid not null references public.rekordbox_imports(id) on delete cascade,
  source_track_id     uuid not null references public.rekordbox_tracks(id) on delete restrict,
  dependent_track_id  uuid not null references public.rekordbox_tracks(id) on delete cascade,
  created_at           timestamptz not null default now(),
  constraint rekordbox_retained_analysis_dependencies_distinct_imports_check
    check (source_import_id <> dependent_import_id),
  constraint rekordbox_retained_analysis_dependencies_dependent_track_unique
    unique (dependent_track_id)
);

create index if not exists rekordbox_retained_analysis_dependencies_source_import_idx
  on public.rekordbox_retained_analysis_dependencies(source_import_id);
create index if not exists rekordbox_retained_analysis_dependencies_dependent_import_idx
  on public.rekordbox_retained_analysis_dependencies(dependent_import_id);

alter table public.rekordbox_retained_analysis_dependencies enable row level security;

-- Backend workers replace the complete unresolved dependency set immediately
-- before persisting a manifest.  A per-user xact lock is shared with deletion,
-- so either dependency registration wins first (and deletion is blocked) or
-- deletion wins first (and the new import must fall back to fresh USB assets).
create or replace function public.replace_rekordbox_retained_analysis_dependencies(
  p_import_id uuid,
  p_dependencies jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_dependency jsonb;
  v_source_import_id uuid;
  v_source_track_id uuid;
  v_dependent_track_id uuid;
  v_count integer := 0;
begin
  select user_id
    into v_user_id
    from public.rekordbox_imports
   where id = p_import_id;

  if v_user_id is null then
    raise exception 'Dependent import not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if not exists (
    select 1
      from public.rekordbox_imports
     where id = p_import_id
       and user_id = v_user_id
       and status not in ('cancel_requested', 'stopping', 'deleting', 'cancelled', 'failed')
  ) then
    raise exception 'Dependent import is not accepting retained-analysis dependencies';
  end if;

  delete from public.rekordbox_retained_analysis_dependencies
   where dependent_import_id = p_import_id;

  for v_dependency in
    select value
      from jsonb_array_elements(coalesce(p_dependencies, '[]'::jsonb))
  loop
    v_source_track_id := nullif(v_dependency ->> 'source_track_id', '')::uuid;
    v_dependent_track_id := nullif(v_dependency ->> 'dependent_track_id', '')::uuid;

    if v_source_track_id is null or v_dependent_track_id is null then
      raise exception 'Invalid retained-analysis dependency payload';
    end if;

    if not exists (
      select 1
        from public.rekordbox_tracks
       where id = v_dependent_track_id
         and import_id = p_import_id
    ) then
      raise exception 'Invalid dependent track for retained-analysis dependency';
    end if;

    select source_track.import_id
      into v_source_import_id
      from public.rekordbox_tracks as source_track
      join public.rekordbox_imports as source_import
        on source_import.id = source_track.import_id
     where source_track.id = v_source_track_id
       and source_import.user_id = v_user_id
       and public.rekordbox_import_is_library_usable(
             source_import.status,
             source_import.library_ready_at
           );

    if v_source_import_id is null or v_source_import_id = p_import_id then
      raise exception 'RETAINED_ANALYSIS_SOURCE_UNAVAILABLE';
    end if;

    insert into public.rekordbox_retained_analysis_dependencies (
      source_import_id,
      dependent_import_id,
      source_track_id,
      dependent_track_id
    ) values (
      v_source_import_id,
      p_import_id,
      v_source_track_id,
      v_dependent_track_id
    )
    on conflict (dependent_track_id) do update
      set source_import_id = excluded.source_import_id,
          source_track_id = excluded.source_track_id,
          created_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.replace_rekordbox_retained_analysis_dependencies(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_rekordbox_retained_analysis_dependencies(uuid, jsonb)
  to service_role;

create or replace function public.release_rekordbox_retained_analysis_dependencies(
  p_import_id uuid,
  p_track_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  delete from public.rekordbox_retained_analysis_dependencies
   where dependent_import_id = p_import_id
     and dependent_track_id = any(coalesce(p_track_ids, '{}'::uuid[]));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.release_rekordbox_retained_analysis_dependencies(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.release_rekordbox_retained_analysis_dependencies(uuid, uuid[])
  to service_role;

-- If the API process died after dependency registration but before the track
-- manifest was persisted, the guard is intentionally fail-safe but stale.
-- Startup recovery prunes only guards whose persisted track intent no longer
-- matches the source relationship. Valid reuse/reparse guards remain intact.
create or replace function public.reconcile_rekordbox_retained_analysis_dependencies(
  p_import_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_count integer := 0;
begin
  select user_id
    into v_user_id
    from public.rekordbox_imports
   where id = p_import_id;

  if v_user_id is null then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  delete from public.rekordbox_retained_analysis_dependencies as dependency
   using public.rekordbox_tracks as dependent_track
   where dependency.dependent_import_id = p_import_id
     and dependent_track.id = dependency.dependent_track_id
     and (
       dependent_track.analysis_reused_from_track_id is distinct from dependency.source_track_id
       or dependent_track.analysis_manifest_status not in (
         'reused', 'metadata_only', 'reparse_from_retained'
       )
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reconcile_rekordbox_retained_analysis_dependencies(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_rekordbox_retained_analysis_dependencies(uuid)
  to service_role;

-- Backfill only dependencies that have not already materialized a dependent
-- import-owned DAT source.  This makes the migration safe while an import is
-- paused/interrupted between manifest planning and parser materialization.
insert into public.rekordbox_retained_analysis_dependencies (
  source_import_id,
  dependent_import_id,
  source_track_id,
  dependent_track_id
)
select source_track.import_id,
       dependent_track.import_id,
       source_track.id,
       dependent_track.id
  from public.rekordbox_tracks as dependent_track
  join public.rekordbox_tracks as source_track
    on source_track.id = dependent_track.analysis_reused_from_track_id
  join public.rekordbox_imports as dependent_import
    on dependent_import.id = dependent_track.import_id
  join public.rekordbox_imports as source_import
    on source_import.id = source_track.import_id
 where dependent_track.analysis_manifest_status = 'reparse_from_retained'
   and source_import.user_id = dependent_import.user_id
   and dependent_import.status not in ('cancel_requested', 'stopping', 'deleting', 'cancelled', 'failed')
   and not exists (
     select 1
       from public.rekordbox_analysis_assets as dependent_asset
      where dependent_asset.import_id = dependent_track.import_id
        and dependent_asset.track_id = dependent_track.id
        and dependent_asset.asset_type = 'DAT'
        and dependent_asset.upload_status in ('staged', 'uploaded', 'archived')
        and (
          dependent_asset.staging_key is not null
          or dependent_asset.storage_path is not null
          or dependent_asset.archive_storage_path is not null
        )
   )
on conflict (dependent_track_id) do nothing;

-- Close the dependency-registration gate before any Storage metadata is read or
-- deleted.  Returning false is a retryable dependency block, not a deletion.
create or replace function public.begin_rekordbox_import_hard_delete(
  p_import_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (
    select 1
      from public.rekordbox_imports
     where id = p_import_id
       and user_id = p_user_id
  ) then
    raise exception 'Import not found';
  end if;

  if exists (
    select 1
      from public.rekordbox_retained_analysis_dependencies
     where source_import_id = p_import_id
  ) then
    return false;
  end if;

  update public.rekordbox_imports
     set status = 'deleting',
         updated_at = now()
   where id = p_import_id
     and user_id = p_user_id;

  return true;
end;
$$;

revoke all on function public.begin_rekordbox_import_hard_delete(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_rekordbox_import_hard_delete(uuid, uuid)
  to service_role;

-- Canonical activation rule: readiness milestone + an activatable durable state.
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
       and public.rekordbox_import_is_library_usable(status, library_ready_at)
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

-- Keep the Stage-0 atomic parent delete/active repair contract, but use the
-- canonical readiness predicate for implicit/current and next fallback choices.
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
  v_settings_needs_repair boolean := false;
  v_effective_active uuid;
  v_next_active uuid;
begin
  if p_active_strategy not in ('activate_next', 'start_over') then
    raise exception 'Invalid delete active strategy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (
    select 1
      from public.rekordbox_imports
     where id = p_import_id
       and user_id = p_user_id
  ) then
    raise exception 'Import not found';
  end if;

  if exists (
    select 1
      from public.rekordbox_retained_analysis_dependencies
     where source_import_id = p_import_id
  ) then
    raise exception 'Retained-analysis dependency still active';
  end if;

  select active_import_id
    into v_effective_active
    from public.rekordbox_user_settings
   where user_id = p_user_id;
  v_settings_exists := found;

  if v_settings_exists
     and v_effective_active is not null
     and v_effective_active <> p_import_id
     and not exists (
    select 1
      from public.rekordbox_imports
     where id = v_effective_active
       and user_id = p_user_id
       and public.rekordbox_import_is_library_usable(status, library_ready_at)
  ) then
    v_settings_needs_repair := true;
    v_effective_active := null;
  end if;

  if not v_settings_exists or v_settings_needs_repair then
    select id
      into v_effective_active
      from public.rekordbox_imports
     where user_id = p_user_id
       and public.rekordbox_import_is_library_usable(status, library_ready_at)
     order by imported_at desc, id desc
     limit 1;
  end if;

  delete from public.rekordbox_imports
   where id = p_import_id
     and user_id = p_user_id;

  if v_effective_active is distinct from p_import_id then
    if v_settings_needs_repair then
      update public.rekordbox_user_settings
         set active_import_id = v_effective_active,
             updated_at = now()
       where user_id = p_user_id;
    end if;
    return v_effective_active;
  end if;

  if p_active_strategy = 'activate_next' then
    select id
      into v_next_active
      from public.rekordbox_imports
     where user_id = p_user_id
       and public.rekordbox_import_is_library_usable(status, library_ready_at)
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

revoke all on function public.hard_delete_rekordbox_import(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.hard_delete_rekordbox_import(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
