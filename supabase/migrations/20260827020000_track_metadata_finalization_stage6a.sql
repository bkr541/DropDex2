-- ============================================================
-- DropDex Genre Editing Stage 6A: metadata finalization/recovery foundation
--
-- A verified local Rekordbox Genre write is not a cloud commit. These columns
-- and narrow SECURITY DEFINER RPCs retain exact local-operation evidence,
-- distinguish recoverable split-brain states, and atomically converge
-- rekordbox_tracks.genre with the draft's moving baseline.
-- ============================================================

alter table public.track_metadata_drafts
  add column if not exists last_apply_draft_fingerprint text,
  add column if not exists last_apply_plan_fingerprint text,
  add column if not exists last_apply_source_identity_before text,
  add column if not exists last_apply_source_identity_after text,
  add column if not exists cloud_finalized_at timestamptz;

alter table public.track_metadata_drafts
  drop constraint if exists track_metadata_drafts_last_apply_state_valid,
  add constraint track_metadata_drafts_last_apply_state_valid
    check (
      last_apply_state is null
      or last_apply_state in (
        'applied',
        'rejected',
        'failed',
        'rolled-back',
        'recovery-unverified',
        'cloud-finalization-pending',
        'cloud-finalization-failed'
      )
    ),
  drop constraint if exists track_metadata_drafts_last_apply_draft_fingerprint_sha256,
  add constraint track_metadata_drafts_last_apply_draft_fingerprint_sha256
    check (
      last_apply_draft_fingerprint is null
      or last_apply_draft_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists track_metadata_drafts_last_apply_plan_fingerprint_sha256,
  add constraint track_metadata_drafts_last_apply_plan_fingerprint_sha256
    check (
      last_apply_plan_fingerprint is null
      or last_apply_plan_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists track_metadata_drafts_source_identity_before_sha256,
  add constraint track_metadata_drafts_source_identity_before_sha256
    check (
      last_apply_source_identity_before is null
      or last_apply_source_identity_before ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists track_metadata_drafts_source_identity_after_sha256,
  add constraint track_metadata_drafts_source_identity_after_sha256
    check (
      last_apply_source_identity_after is null
      or last_apply_source_identity_after ~ '^[0-9a-f]{64}$'
    );

-- Persist only a deliberately small diagnostic projection. In particular, raw
-- desktop exception messages and filesystem paths never cross this boundary.
create or replace function public.safe_track_metadata_apply_summary_v1(
  p_summary jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_summary jsonb := coalesce(p_summary, '{}'::jsonb);
  v_code text;
  v_blocker_codes jsonb;
  v_warning_codes jsonb;
  v_rollback_verified boolean;
begin
  if jsonb_typeof(v_summary) <> 'object' then
    raise exception 'metadata_apply_invalid_summary' using errcode = '22023';
  end if;

  v_code := nullif(left(coalesce(v_summary ->> 'code', ''), 128), '');

  if v_summary ? 'blockerCodes' then
    if jsonb_typeof(v_summary -> 'blockerCodes') <> 'array'
       or jsonb_array_length(v_summary -> 'blockerCodes') > 32 then
      raise exception 'metadata_apply_invalid_summary' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(left(value, 128)), '[]'::jsonb)
      into v_blocker_codes
      from jsonb_array_elements_text(v_summary -> 'blockerCodes');
  end if;

  if v_summary ? 'warningCodes' then
    if jsonb_typeof(v_summary -> 'warningCodes') <> 'array'
       or jsonb_array_length(v_summary -> 'warningCodes') > 32 then
      raise exception 'metadata_apply_invalid_summary' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(left(value, 128)), '[]'::jsonb)
      into v_warning_codes
      from jsonb_array_elements_text(v_summary -> 'warningCodes');
  end if;

  if v_summary ? 'rollbackVerified' then
    if jsonb_typeof(v_summary -> 'rollbackVerified') <> 'boolean' then
      raise exception 'metadata_apply_invalid_summary' using errcode = '22023';
    end if;
    v_rollback_verified := (v_summary ->> 'rollbackVerified')::boolean;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'code', v_code,
    'blockerCodes', v_blocker_codes,
    'warningCodes', v_warning_codes,
    'rollbackVerified', v_rollback_verified
  ));
end;
$$;

revoke all on function public.safe_track_metadata_apply_summary_v1(jsonb) from public, anon, authenticated;

-- Record Stage 4/5 outcomes without advancing the canonical cloud baseline.
-- For local-success/cloud-finalization states, exact verified local evidence is
-- retained so renderer reload/re-entry can reconstruct a safe recovery request.
create or replace function public.mark_track_metadata_apply_outcome_v1(
  p_import_id uuid,
  p_track_id uuid,
  p_field text,
  p_revision bigint,
  p_draft_fingerprint text,
  p_operation_id text,
  p_plan_fingerprint text,
  p_apply_state text,
  p_applied_value text default null,
  p_source_identity_before text default null,
  p_source_identity_after text default null,
  p_result_summary jsonb default null
)
returns setof public.track_metadata_drafts
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.track_metadata_drafts%rowtype;
  v_saved public.track_metadata_drafts%rowtype;
  v_applied_value text;
  v_summary jsonb;
  v_is_local_success boolean;
begin
  if v_user_id is null then
    raise exception 'metadata_apply_auth_required' using errcode = '42501';
  end if;

  if p_field is distinct from 'genre'
     or p_revision is null
     or p_revision <= 0
     or coalesce(p_draft_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_operation_id, '') = ''
     or char_length(p_operation_id) > 256
     or coalesce(p_plan_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_apply_state, '') not in (
       'rejected',
       'failed',
       'rolled-back',
       'recovery-unverified',
       'cloud-finalization-pending',
       'cloud-finalization-failed'
     )
     or (p_source_identity_before is not null and p_source_identity_before !~ '^[0-9a-f]{64}$')
     or (p_source_identity_after is not null and p_source_identity_after !~ '^[0-9a-f]{64}$') then
    raise exception 'metadata_apply_invalid_result' using errcode = '22023';
  end if;

  v_is_local_success := p_apply_state in ('cloud-finalization-pending', 'cloud-finalization-failed');
  v_applied_value := public.normalize_track_metadata_value_v1(p_field, p_applied_value);
  v_summary := public.safe_track_metadata_apply_summary_v1(p_result_summary);

  if v_is_local_success and p_source_identity_after is null then
    raise exception 'metadata_apply_missing_local_success_evidence' using errcode = '22023';
  end if;
  if not v_is_local_success and p_applied_value is not null then
    raise exception 'metadata_apply_unexpected_applied_value' using errcode = '22023';
  end if;

  -- Authorize through canonical ownership before looking up the draft, avoiding
  -- a cross-user draft-existence oracle.
  perform 1
    from public.rekordbox_tracks t
    join public.rekordbox_imports i on i.id = t.import_id
   where t.id = p_track_id
     and t.import_id = p_import_id
     and i.user_id = v_user_id;
  if not found then
    raise exception 'metadata_apply_owner_mismatch' using errcode = '42501';
  end if;

  select *
    into v_current
    from public.track_metadata_drafts d
   where d.user_id = v_user_id
     and d.import_id = p_import_id
     and d.track_id = p_track_id
     and d.field = p_field
   for update;

  if not found
     or v_current.revision <> p_revision
     or v_current.draft_fingerprint <> lower(p_draft_fingerprint) then
    raise exception 'metadata_apply_revision_conflict' using errcode = '40001';
  end if;

  if v_is_local_success
     and v_current.pending_value is distinct from v_applied_value then
    raise exception 'metadata_apply_applied_value_mismatch' using errcode = '40001';
  end if;

  -- Same operation/state persistence is a lost-response-safe retry. Changing
  -- the meaning of an already-recorded operation is an idempotency conflict.
  if v_current.last_apply_operation_id = p_operation_id then
    if v_current.last_apply_draft_fingerprint = lower(p_draft_fingerprint)
       and v_current.last_apply_plan_fingerprint = lower(p_plan_fingerprint)
       and (
         not v_is_local_success
         or (
           v_current.applied_revision = p_revision
           and v_current.applied_value is not distinct from v_applied_value
           and v_current.last_apply_source_identity_after = lower(p_source_identity_after)
         )
       ) then
      if v_current.last_apply_state = p_apply_state then
        return next v_current;
        return;
      end if;
      -- Cloud retry bookkeeping may move the same verified local operation
      -- between pending and failed without changing any local-success proof.
      if v_current.last_apply_state in ('cloud-finalization-pending', 'cloud-finalization-failed')
         and p_apply_state in ('cloud-finalization-pending', 'cloud-finalization-failed') then
        update public.track_metadata_drafts
           set last_apply_state = p_apply_state,
               last_apply_summary = v_summary,
               updated_at = now()
         where id = v_current.id
        returning * into v_saved;
        return next v_saved;
        return;
      end if;
    end if;
    raise exception 'metadata_apply_idempotency_conflict' using errcode = '40001';
  end if;

  update public.track_metadata_drafts
     set last_apply_operation_id = p_operation_id,
         last_apply_state = p_apply_state,
         last_apply_summary = v_summary,
         last_apply_draft_fingerprint = lower(p_draft_fingerprint),
         last_apply_plan_fingerprint = lower(p_plan_fingerprint),
         last_apply_source_identity_before = lower(p_source_identity_before),
         last_apply_source_identity_after = lower(p_source_identity_after),
         applied_revision = case when v_is_local_success then p_revision else applied_revision end,
         applied_value = case when v_is_local_success then v_applied_value else applied_value end,
         applied_at = case when v_is_local_success then coalesce(applied_at, now()) else applied_at end,
         cloud_finalized_at = case when v_is_local_success then null else cloud_finalized_at end,
         updated_at = now()
   where id = v_current.id
  returning * into v_saved;

  return next v_saved;
end;
$$;

revoke all on function public.mark_track_metadata_apply_outcome_v1(uuid, uuid, text, bigint, text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.mark_track_metadata_apply_outcome_v1(uuid, uuid, text, bigint, text, text, text, text, text, text, text, jsonb) to authenticated;

-- Atomically converge canonical cloud Genre and the moving metadata baseline.
-- The local-success evidence must already be durably attached to this exact
-- draft operation. The exact duplicate finalized request is idempotent even
-- though rebasing intentionally changes draft_fingerprint.
create or replace function public.finalize_track_metadata_apply_v1(
  p_import_id uuid,
  p_track_id uuid,
  p_field text,
  p_revision bigint,
  p_draft_fingerprint text,
  p_operation_id text,
  p_plan_fingerprint text,
  p_applied_value text,
  p_expected_current_baseline_value text,
  p_master_db_id text,
  p_master_content_id text,
  p_source_identity_after text
)
returns setof public.track_metadata_drafts
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_track public.rekordbox_tracks%rowtype;
  v_current public.track_metadata_drafts%rowtype;
  v_saved public.track_metadata_drafts%rowtype;
  v_applied_value text;
  v_expected_baseline text;
begin
  if v_user_id is null then
    raise exception 'metadata_apply_auth_required' using errcode = '42501';
  end if;

  if p_field is distinct from 'genre'
     or p_revision is null
     or p_revision <= 0
     or coalesce(p_draft_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_operation_id, '') = ''
     or char_length(p_operation_id) > 256
     or coalesce(p_plan_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or coalesce(btrim(p_master_db_id), '') = ''
     or coalesce(btrim(p_master_content_id), '') = ''
     or coalesce(p_source_identity_after, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'metadata_apply_invalid_finalize_request' using errcode = '22023';
  end if;

  v_applied_value := public.normalize_track_metadata_value_v1(p_field, p_applied_value);
  v_expected_baseline := public.normalize_track_metadata_value_v1(p_field, p_expected_current_baseline_value);

  select t.*
    into v_track
    from public.rekordbox_tracks t
    join public.rekordbox_imports i on i.id = t.import_id
   where t.id = p_track_id
     and t.import_id = p_import_id
     and i.user_id = v_user_id
   for update of t;

  if not found then
    raise exception 'metadata_apply_owner_mismatch' using errcode = '42501';
  end if;

  select *
    into v_current
    from public.track_metadata_drafts d
   where d.user_id = v_user_id
     and d.import_id = p_import_id
     and d.track_id = p_track_id
     and d.field = p_field
   for update;

  if not found then
    raise exception 'metadata_apply_draft_missing' using errcode = '40001';
  end if;

  -- Lost response after commit: the original apply fingerprint is retained in
  -- operation evidence because the current draft fingerprint changes on rebase.
  if v_current.last_apply_operation_id = p_operation_id
     and v_current.last_apply_state = 'applied' then
    if v_current.applied_revision = p_revision
       and v_current.last_apply_draft_fingerprint = lower(p_draft_fingerprint)
       and v_current.last_apply_plan_fingerprint = lower(p_plan_fingerprint)
       and v_current.applied_value is not distinct from v_applied_value
       and v_current.current_baseline_value is not distinct from v_applied_value
       and v_track.genre is not distinct from v_applied_value
       and v_current.master_db_id = p_master_db_id
       and v_current.master_content_id = p_master_content_id
       and v_track.master_db_id = p_master_db_id
       and v_track.master_content_id = p_master_content_id
       and v_current.last_apply_source_identity_after = lower(p_source_identity_after) then
      return next v_current;
      return;
    end if;
    raise exception 'metadata_apply_idempotency_conflict' using errcode = '40001';
  end if;

  if v_current.revision <> p_revision
     or v_current.draft_fingerprint <> lower(p_draft_fingerprint)
     or v_current.pending_value is distinct from v_applied_value
     or v_current.current_baseline_value is distinct from v_expected_baseline
     or v_track.genre is distinct from v_expected_baseline then
    raise exception 'metadata_apply_revision_conflict' using errcode = '40001';
  end if;

  if v_current.master_db_id <> p_master_db_id
     or v_current.master_content_id <> p_master_content_id
     or v_track.master_db_id <> p_master_db_id
     or v_track.master_content_id <> p_master_content_id then
    raise exception 'metadata_apply_master_identity_conflict' using errcode = '40001';
  end if;

  if v_current.last_apply_operation_id <> p_operation_id
     or v_current.last_apply_state not in ('cloud-finalization-pending', 'cloud-finalization-failed')
     or v_current.last_apply_draft_fingerprint <> lower(p_draft_fingerprint)
     or v_current.last_apply_plan_fingerprint <> lower(p_plan_fingerprint)
     or v_current.applied_revision <> p_revision
     or v_current.applied_value is distinct from v_applied_value
     or v_current.last_apply_source_identity_after <> lower(p_source_identity_after) then
    raise exception 'metadata_apply_operation_evidence_mismatch' using errcode = '40001';
  end if;

  update public.rekordbox_tracks
     set genre = v_applied_value
   where id = v_track.id;

  update public.track_metadata_drafts
     set current_baseline_value = v_applied_value,
         draft_fingerprint = public.track_metadata_draft_fingerprint_v1(
           track_id,
           field,
           schema_version,
           pending_value,
           v_applied_value
         ),
         last_apply_state = 'applied',
         cloud_finalized_at = now(),
         updated_at = now()
   where id = v_current.id
  returning * into v_saved;

  return next v_saved;
end;
$$;

revoke all on function public.finalize_track_metadata_apply_v1(uuid, uuid, text, bigint, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.finalize_track_metadata_apply_v1(uuid, uuid, text, bigint, text, text, text, text, text, text, text, text) to authenticated;

-- Recovery lock: ordinary editor mutation/discard cannot destroy the operation
-- evidence needed to reconcile a verified local write with stale cloud state.
create or replace function public.save_track_metadata_draft_v1(
  p_import_id uuid,
  p_track_id uuid,
  p_field text,
  p_schema_version integer,
  p_pending_value text,
  p_expected_revision bigint
)
returns setof public.track_metadata_drafts
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_canonical_value text;
  v_master_db_id text;
  v_master_content_id text;
  v_pending_value text;
  v_current public.track_metadata_drafts%rowtype;
  v_saved public.track_metadata_drafts%rowtype;
begin
  if v_user_id is null then
    raise exception 'metadata_draft_auth_required' using errcode = '42501';
  end if;
  if p_schema_version is distinct from 1 or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'metadata_draft_invalid_request' using errcode = '22023';
  end if;
  v_pending_value := public.normalize_track_metadata_value_v1(p_field, p_pending_value);

  select t.genre, t.master_db_id, t.master_content_id
    into v_canonical_value, v_master_db_id, v_master_content_id
    from public.rekordbox_tracks t
    join public.rekordbox_imports i on i.id = t.import_id
   where t.id = p_track_id and t.import_id = p_import_id and i.user_id = v_user_id
   for share of t;
  if not found then raise exception 'metadata_draft_owner_mismatch' using errcode = '42501'; end if;
  if coalesce(btrim(v_master_db_id), '') = '' or coalesce(btrim(v_master_content_id), '') = '' then
    raise exception 'metadata_draft_missing_master_identity' using errcode = '22023';
  end if;

  select * into v_current
    from public.track_metadata_drafts d
   where d.user_id = v_user_id and d.track_id = p_track_id and d.field = p_field
   for update;

  if found then
    if v_current.import_id <> p_import_id then raise exception 'metadata_draft_owner_mismatch' using errcode = '42501'; end if;
    if v_current.last_apply_state in ('cloud-finalization-pending', 'cloud-finalization-failed', 'recovery-unverified') then
      raise exception 'metadata_draft_recovery_locked' using errcode = '55000';
    end if;
    if p_expected_revision <> v_current.revision then raise exception 'metadata_draft_revision_conflict' using errcode = '40001'; end if;

    if v_pending_value is not distinct from v_current.current_baseline_value then
      -- Preserve Stage 1's no-false-pending behavior for never-applied drafts.
      -- Once an operation history exists, retain the row as durable provenance;
      -- pending == moving baseline still means it no longer needs Apply.
      if v_current.last_apply_operation_id is null then
        delete from public.track_metadata_drafts where id = v_current.id;
        return;
      end if;
      update public.track_metadata_drafts
         set pending_value = v_pending_value,
             master_db_id = v_master_db_id,
             master_content_id = v_master_content_id,
             revision = revision + 1,
             draft_fingerprint = public.track_metadata_draft_fingerprint_v1(
               p_track_id, p_field, p_schema_version, v_pending_value, current_baseline_value
             ),
             updated_at = now()
       where id = v_current.id
      returning * into v_saved;
      return next v_saved;
      return;
    end if;

    update public.track_metadata_drafts
       set schema_version = p_schema_version,
           pending_value = v_pending_value,
           master_db_id = v_master_db_id,
           master_content_id = v_master_content_id,
           revision = revision + 1,
           draft_fingerprint = public.track_metadata_draft_fingerprint_v1(
             p_track_id, p_field, p_schema_version, v_pending_value, current_baseline_value
           ),
           updated_at = now()
     where id = v_current.id
    returning * into v_saved;
    return next v_saved;
    return;
  end if;

  if p_expected_revision <> 0 then raise exception 'metadata_draft_revision_conflict' using errcode = '40001'; end if;
  if v_pending_value is not distinct from v_canonical_value then return; end if;

  begin
    insert into public.track_metadata_drafts (
      user_id, import_id, track_id, field, schema_version, pending_value,
      imported_baseline_value, current_baseline_value, master_db_id,
      master_content_id, revision, draft_fingerprint
    ) values (
      v_user_id, p_import_id, p_track_id, p_field, p_schema_version, v_pending_value,
      v_canonical_value, v_canonical_value, v_master_db_id, v_master_content_id, 1,
      public.track_metadata_draft_fingerprint_v1(p_track_id, p_field, p_schema_version, v_pending_value, v_canonical_value)
    ) returning * into v_saved;
  exception when unique_violation then
    raise exception 'metadata_draft_revision_conflict' using errcode = '40001';
  end;
  return next v_saved;
end;
$$;

revoke all on function public.save_track_metadata_draft_v1(uuid, uuid, text, integer, text, bigint) from public, anon;
grant execute on function public.save_track_metadata_draft_v1(uuid, uuid, text, integer, text, bigint) to authenticated;

create or replace function public.discard_track_metadata_draft_v1(
  p_import_id uuid,
  p_track_id uuid,
  p_field text,
  p_expected_revision bigint
)
returns setof public.track_metadata_drafts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.track_metadata_drafts%rowtype;
  v_deleted public.track_metadata_drafts%rowtype;
begin
  if v_user_id is null then raise exception 'metadata_draft_auth_required' using errcode = '42501'; end if;
  if p_field is distinct from 'genre' or p_expected_revision is null or p_expected_revision <= 0 then
    raise exception 'metadata_draft_invalid_request' using errcode = '22023';
  end if;

  perform 1 from public.rekordbox_tracks t
    join public.rekordbox_imports i on i.id = t.import_id
   where t.id = p_track_id and t.import_id = p_import_id and i.user_id = v_user_id;
  if not found then raise exception 'metadata_draft_owner_mismatch' using errcode = '42501'; end if;

  select * into v_current from public.track_metadata_drafts d
   where d.user_id = v_user_id and d.import_id = p_import_id and d.track_id = p_track_id and d.field = p_field
   for update;
  if not found then return; end if;
  if v_current.revision <> p_expected_revision then raise exception 'metadata_draft_revision_conflict' using errcode = '40001'; end if;
  if v_current.last_apply_state in ('cloud-finalization-pending', 'cloud-finalization-failed', 'recovery-unverified') then
    raise exception 'metadata_draft_recovery_locked' using errcode = '55000';
  end if;

  if v_current.last_apply_operation_id is not null then
    update public.track_metadata_drafts
       set pending_value = current_baseline_value,
           revision = revision + 1,
           draft_fingerprint = public.track_metadata_draft_fingerprint_v1(
             track_id, field, schema_version, current_baseline_value, current_baseline_value
           ),
           updated_at = now()
     where id = v_current.id
    returning * into v_deleted;
    return next v_deleted;
    return;
  end if;

  delete from public.track_metadata_drafts where id = v_current.id returning * into v_deleted;
  return next v_deleted;
end;
$$;

revoke all on function public.discard_track_metadata_draft_v1(uuid, uuid, text, bigint) from public, anon;
grant execute on function public.discard_track_metadata_draft_v1(uuid, uuid, text, bigint) to authenticated;
