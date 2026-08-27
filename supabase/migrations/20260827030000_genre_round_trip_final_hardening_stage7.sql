-- ============================================================
-- DropDex Genre Editing Stage 7: round-trip fidelity / final hardening
--
-- Final-stage invariants added here:
--   1. unresolved pending Genre intent and local-success recovery evidence
--      cannot be silently erased by Rekordbox import hard-delete lifecycle work;
--   2. once import deletion has started, no new unresolved metadata intent can
--      race into that snapshot;
--   3. failed/rejected/rolled-back/recovery-unverified attempts cannot inherit
--      applied-value evidence from an older successful operation.
-- ============================================================

begin;

-- A single server-owned predicate is used by both the pre-delete backend check
-- and the transaction-boundary hard-delete RPCs. Recovery is reported first
-- because it represents a verified/possibly-verified local Rekordbox mutation
-- whose cloud reconciliation evidence must never be cascaded away.
create or replace function public.rekordbox_import_metadata_delete_block_v1(
  p_import_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
      from public.rekordbox_imports i
     where i.id = p_import_id
       and i.user_id = p_user_id
  ) then
    raise exception 'Import not found';
  end if;

  if exists (
    select 1
      from public.track_metadata_drafts d
     where d.import_id = p_import_id
       and d.user_id = p_user_id
       and d.last_apply_state in (
         'cloud-finalization-pending',
         'cloud-finalization-failed',
         'recovery-unverified'
       )
  ) then
    return 'recovery';
  end if;

  if exists (
    select 1
      from public.track_metadata_drafts d
     where d.import_id = p_import_id
       and d.user_id = p_user_id
       and d.pending_value is distinct from d.current_baseline_value
  ) then
    return 'pending';
  end if;

  return null;
end;
$$;

revoke all on function public.rekordbox_import_metadata_delete_block_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rekordbox_import_metadata_delete_block_v1(uuid, uuid)
  to service_role;

-- Once deletion is in flight, do not let a fresh pending edit race in after the
-- pre-delete predicate was evaluated. This trigger does not prevent resolving
-- an existing pending row back to its baseline. It also independently protects
-- unresolved local-success recovery evidence from a cascade DELETE.
create or replace function public.guard_track_metadata_draft_delete_lifecycle_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_import_status text;
  v_has_unresolved_state boolean;
begin
  if tg_op = 'DELETE' then
    if old.last_apply_state in (
      'cloud-finalization-pending',
      'cloud-finalization-failed',
      'recovery-unverified'
    ) then
      raise exception 'metadata_draft_recovery_locked' using errcode = '55000';
    end if;
    return old;
  end if;

  v_has_unresolved_state :=
    new.pending_value is distinct from new.current_baseline_value
    or new.last_apply_state in (
      'cloud-finalization-pending',
      'cloud-finalization-failed',
      'recovery-unverified'
    );

  if v_has_unresolved_state then
    select i.status
      into v_import_status
      from public.rekordbox_imports i
     where i.id = new.import_id
       and i.user_id = new.user_id;

    if v_import_status in ('cancel_requested', 'stopping', 'deleting', 'cancelled') then
      raise exception 'metadata_draft_import_deleting' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_track_metadata_draft_delete_lifecycle_v1()
  from public, anon, authenticated;

drop trigger if exists track_metadata_drafts_delete_lifecycle_guard
  on public.track_metadata_drafts;
create trigger track_metadata_drafts_delete_lifecycle_guard
before insert or update or delete on public.track_metadata_drafts
for each row
execute function public.guard_track_metadata_draft_delete_lifecycle_v1();

-- A later non-success attempt must not carry applied_* proof from an earlier
-- successful operation. Preserve pending/current baselines and safe diagnostic
-- fingerprints, but make the operation evidence self-consistent.
update public.track_metadata_drafts
   set applied_revision = null,
       applied_value = null,
       applied_at = null,
       cloud_finalized_at = null
 where last_apply_state in ('rejected', 'failed', 'rolled-back', 'recovery-unverified');

create or replace function public.normalize_track_metadata_apply_evidence_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.last_apply_state in ('rejected', 'failed', 'rolled-back', 'recovery-unverified') then
    new.applied_revision := null;
    new.applied_value := null;
    new.applied_at := null;
    new.cloud_finalized_at := null;
  elsif tg_op = 'UPDATE'
        and new.last_apply_state in ('cloud-finalization-pending', 'cloud-finalization-failed')
        and old.last_apply_operation_id is distinct from new.last_apply_operation_id then
    -- Stage 6A intentionally retained applied_at for retries of the same local
    -- operation, but that also retained an older operation's timestamp after a
    -- later successful write. A new operation gets a new applied timestamp; the
    -- same operation's pending<->failed cloud bookkeeping keeps it unchanged.
    new.applied_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_track_metadata_apply_evidence_v1()
  from public, anon, authenticated;

drop trigger if exists track_metadata_drafts_apply_evidence_normalizer
  on public.track_metadata_drafts;
create trigger track_metadata_drafts_apply_evidence_normalizer
before insert or update of last_apply_operation_id, last_apply_state, applied_revision, applied_value, applied_at, cloud_finalized_at
on public.track_metadata_drafts
for each row
execute function public.normalize_track_metadata_apply_evidence_v1();

alter table public.track_metadata_drafts
  drop constraint if exists track_metadata_drafts_non_success_has_no_applied_evidence,
  add constraint track_metadata_drafts_non_success_has_no_applied_evidence
    check (
      last_apply_state not in ('rejected', 'failed', 'rolled-back', 'recovery-unverified')
      or (
        applied_revision is null
        and applied_value is null
        and applied_at is null
        and cloud_finalized_at is null
      )
    );

-- Re-state the destructive gates with the Stage 7 metadata predicate inside the
-- same user-scoped advisory-lock transaction. The backend performs an earlier
-- UX-friendly precheck, but these checks are authoritative and close races.
create or replace function public.begin_rekordbox_import_hard_delete(
  p_import_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata_block text;
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

  v_metadata_block := public.rekordbox_import_metadata_delete_block_v1(
    p_import_id,
    p_user_id
  );
  if v_metadata_block is not null then
    raise exception 'metadata_delete_blocked:%', v_metadata_block using errcode = '55000';
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
  v_metadata_block text;
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

  v_metadata_block := public.rekordbox_import_metadata_delete_block_v1(
    p_import_id,
    p_user_id
  );
  if v_metadata_block is not null then
    raise exception 'metadata_delete_blocked:%', v_metadata_block using errcode = '55000';
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
