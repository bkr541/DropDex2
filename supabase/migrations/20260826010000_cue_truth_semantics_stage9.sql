-- DropDex Stage 9: rebase cue safety truth only after a verified local Apply.
--
-- The original Stage 7 RPC remains available for compatibility. Production
-- Stage 9 uses this v2 RPC because it also advances the semantic and local-DB
-- baselines to the exact revision that the desktop bridge verified on disk.
create or replace function public.mark_cue_draft_applied_v2(
  p_track_id uuid,
  p_revision bigint,
  p_desired_fingerprint text,
  p_post_apply_local_cue_fingerprint text,
  p_operation_id text,
  p_result_summary jsonb default null
)
returns setof public.cue_drafts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'cue_apply_auth_required' using errcode = '42501';
  end if;
  if p_revision <= 0
     or coalesce(p_desired_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_post_apply_local_cue_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_operation_id, '') = '' then
    raise exception 'cue_apply_invalid_result' using errcode = '22023';
  end if;

  return query
  update public.cue_drafts
     set applied_revision = p_revision,
         applied_fingerprint = lower(p_desired_fingerprint),
         applied_at = now(),
         -- Successful Apply establishes a new trustworthy current-local baseline.
         -- This prevents the next legitimate edit from comparing against the
         -- pre-Apply generation forever.
         imported_baseline_fingerprint = lower(p_desired_fingerprint),
         imported_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint),
         last_apply_operation_id = p_operation_id,
         last_apply_state = 'applied',
         last_apply_summary = p_result_summary
   where user_id = v_user_id
     and track_id = p_track_id
     and revision = p_revision
     and desired_fingerprint = lower(p_desired_fingerprint)
  returning *;

  if not found then
    raise exception 'cue_apply_revision_conflict' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.mark_cue_draft_applied_v2(uuid, bigint, text, text, text, jsonb) from public, anon;
grant execute on function public.mark_cue_draft_applied_v2(uuid, bigint, text, text, text, jsonb) to authenticated;
