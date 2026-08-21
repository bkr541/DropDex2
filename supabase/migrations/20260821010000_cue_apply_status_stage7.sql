-- DropDex Stage 7: revision-safe local Rekordbox apply status.
alter table public.cue_drafts
  add column if not exists applied_revision bigint,
  add column if not exists applied_fingerprint text,
  add column if not exists applied_at timestamptz,
  add column if not exists last_apply_operation_id text,
  add column if not exists last_apply_state text,
  add column if not exists last_apply_summary jsonb;

alter table public.cue_drafts
  drop constraint if exists cue_drafts_applied_revision_positive,
  add constraint cue_drafts_applied_revision_positive
    check (applied_revision is null or applied_revision > 0),
  drop constraint if exists cue_drafts_applied_fingerprint_sha256,
  add constraint cue_drafts_applied_fingerprint_sha256
    check (applied_fingerprint is null or applied_fingerprint ~ '^[0-9a-f]{64}$');

create or replace function public.mark_cue_draft_applied(
  p_track_id uuid,
  p_revision bigint,
  p_desired_fingerprint text,
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
     or coalesce(p_operation_id, '') = '' then
    raise exception 'cue_apply_invalid_result' using errcode = '22023';
  end if;

  return query
  update public.cue_drafts
     set applied_revision = p_revision,
         applied_fingerprint = p_desired_fingerprint,
         applied_at = now(),
         last_apply_operation_id = p_operation_id,
         last_apply_state = 'applied',
         last_apply_summary = p_result_summary
   where user_id = v_user_id
     and track_id = p_track_id
     and revision = p_revision
     and desired_fingerprint = p_desired_fingerprint
  returning *;

  if not found then
    raise exception 'cue_apply_revision_conflict' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.mark_cue_draft_applied(uuid, bigint, text, text, jsonb) from public, anon;
grant execute on function public.mark_cue_draft_applied(uuid, bigint, text, text, jsonb) to authenticated;
