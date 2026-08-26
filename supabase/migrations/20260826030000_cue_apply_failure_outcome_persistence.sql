-- DropDex: persist non-successful Rekordbox cue Apply outcomes durably.
--
-- Successful, verified Apply continues to use mark_cue_draft_applied_v3 because
-- only that path may advance applied/current-baseline proof. This RPC records
-- rejected/rolled-back/recovery-unverified attempts without changing any
-- successful-apply or verified-baseline columns.

alter table public.cue_drafts
  drop constraint if exists cue_drafts_last_apply_state_valid,
  add constraint cue_drafts_last_apply_state_valid
    check (
      last_apply_state is null
      or last_apply_state in ('applied', 'rejected', 'rolled-back', 'recovery-unverified')
    );

create or replace function public.mark_cue_draft_apply_outcome_v1(
  p_import_id uuid,
  p_track_id uuid,
  p_revision bigint,
  p_desired_fingerprint text,
  p_operation_id text,
  p_apply_state text,
  p_result_summary jsonb default null
)
returns setof public.cue_drafts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.cue_drafts%rowtype;
  v_saved public.cue_drafts%rowtype;
begin
  if v_user_id is null then
    raise exception 'cue_apply_auth_required' using errcode = '42501';
  end if;

  if p_revision <= 0
     or coalesce(p_desired_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_operation_id, '') = ''
     or coalesce(p_apply_state, '') not in ('rejected', 'rolled-back', 'recovery-unverified') then
    raise exception 'cue_apply_invalid_result' using errcode = '22023';
  end if;

  select *
    into v_current
    from public.cue_drafts
   where user_id = v_user_id
     and import_id = p_import_id
     and track_id = p_track_id
   for update;

  -- Never attach a stale desktop result to a newer/different cloud draft.
  if not found
     or v_current.revision <> p_revision
     or v_current.desired_fingerprint <> lower(p_desired_fingerprint) then
    raise exception 'cue_apply_revision_conflict' using errcode = '40001';
  end if;

  -- Retrying persistence for the exact same operation/state is idempotent.
  if v_current.last_apply_operation_id = p_operation_id then
    if v_current.last_apply_state = p_apply_state then
      return next v_current;
      return;
    end if;
    raise exception 'cue_apply_idempotency_conflict' using errcode = '40001';
  end if;

  update public.cue_drafts
     set last_apply_operation_id = p_operation_id,
         last_apply_state = p_apply_state,
         last_apply_summary = p_result_summary
   where id = v_current.id
  returning * into v_saved;

  return next v_saved;
end;
$$;

revoke all on function public.mark_cue_draft_apply_outcome_v1(uuid, uuid, bigint, text, text, text, jsonb) from public, anon;
grant execute on function public.mark_cue_draft_apply_outcome_v1(uuid, uuid, bigint, text, text, text, jsonb) to authenticated;
