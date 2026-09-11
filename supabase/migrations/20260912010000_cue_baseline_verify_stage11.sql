-- DropDex Stage 11: narrow update_cue_baseline_fingerprint RPC.
--
-- Populates current_baseline_local_cue_fingerprint after a live desktop
-- verifyCueBaseline observation. This is the only mutation path for that
-- column outside of Apply. imported_baseline_* columns are never touched.
--
-- The revision check prevents racing concurrent saves from overwriting a
-- more recently saved draft's baseline. A stale revision means the row was
-- modified after the caller last read it; the RPC raises rather than silently
-- accepting an out-of-date fingerprint.

create or replace function public.update_cue_baseline_fingerprint(
  p_import_id uuid,
  p_track_id uuid,
  p_revision bigint,
  p_current_baseline_local_cue_fingerprint text
)
returns setof public.cue_drafts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated public.cue_drafts%rowtype;
begin
  if v_user_id is null then
    raise exception 'cue_draft_auth_required' using errcode = '42501';
  end if;

  if p_current_baseline_local_cue_fingerprint is null
     or p_current_baseline_local_cue_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'cue_draft_invalid_fingerprint' using errcode = '22023';
  end if;

  update public.cue_drafts
     set current_baseline_local_cue_fingerprint = p_current_baseline_local_cue_fingerprint,
         updated_at = now()
   where user_id = v_user_id
     and import_id = p_import_id
     and track_id = p_track_id
     and revision = p_revision
  returning * into v_updated;

  if not found then
    raise exception 'cue_draft_revision_conflict' using errcode = '42P01';
  end if;

  return next v_updated;
end;
$$;

revoke all on function public.update_cue_baseline_fingerprint(uuid, uuid, bigint, text) from public;
grant execute on function public.update_cue_baseline_fingerprint(uuid, uuid, bigint, text) to authenticated;
