-- DropDex Stage 10: durable current-local cue baselines and revision-safe post-Apply rebase.
--
-- Stage 9 proved the verified local cue fingerprint after Apply, but reused the
-- imported_* columns as the moving comparison baseline. Stage 10 separates the
-- immutable import provenance from the current comparable local baseline. Rows
-- that already passed through Stage 9 cannot reconstruct overwritten historical
-- fingerprints here, so their last known safe comparison baseline is preserved
-- as both provenance and current baseline; raw imported cue evidence remains in
-- rekordbox_cues.

alter table public.cue_drafts
  add column if not exists current_baseline_fingerprint text,
  add column if not exists current_baseline_local_cue_fingerprint text;

alter table public.cue_drafts
  drop constraint if exists cue_drafts_current_baseline_fingerprint_sha256,
  add constraint cue_drafts_current_baseline_fingerprint_sha256
    check (
      current_baseline_fingerprint is null
      or current_baseline_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists cue_drafts_current_local_fingerprint_sha256,
  add constraint cue_drafts_current_local_fingerprint_sha256
    check (
      current_baseline_local_cue_fingerprint is null
      or current_baseline_local_cue_fingerprint ~ '^[0-9a-f]{64}$'
    );

-- This is a provenance-preserving migration of the comparison baseline already
-- trusted by the previous stage, not a synthesis from editor/reconciled state.
update public.cue_drafts
   set current_baseline_fingerprint = coalesce(
         current_baseline_fingerprint,
         imported_baseline_fingerprint
       ),
       current_baseline_local_cue_fingerprint = coalesce(
         current_baseline_local_cue_fingerprint,
         imported_baseline_local_cue_fingerprint
       )
 where current_baseline_fingerprint is null
    or (
      current_baseline_local_cue_fingerprint is null
      and imported_baseline_local_cue_fingerprint is not null
    );

-- Preserve imported provenance on ordinary saves. The moving current baseline
-- changes only after verified Apply/rebase. Legacy rows missing local proof may
-- still acquire that proof through a fresh save, matching the Stage 1 contract.
create or replace function public.save_cue_draft(
  p_import_id uuid,
  p_track_id uuid,
  p_rekordbox_content_id text,
  p_schema_version integer,
  p_desired_document jsonb,
  p_desired_fingerprint text,
  p_imported_baseline_fingerprint text,
  p_expected_revision bigint,
  p_strategy_version text default null,
  p_strategy_settings jsonb default null,
  p_imported_baseline_local_cue_fingerprint text default null
)
returns setof public.cue_drafts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_saved public.cue_drafts%rowtype;
  v_master_db_id text;
  v_master_content_id text;
begin
  if v_user_id is null then
    raise exception 'cue_draft_auth_required' using errcode = '42501';
  end if;

  if p_expected_revision < 0 then
    raise exception 'cue_draft_invalid_expected_revision' using errcode = '22023';
  end if;

  if p_schema_version <= 0
     or p_desired_document is null
     or jsonb_typeof(p_desired_document) <> 'object'
     or coalesce(jsonb_typeof(p_desired_document -> 'cues'), '') <> 'array'
     or coalesce(p_desired_document ->> 'importId', '') <> p_import_id::text
     or coalesce(p_desired_document ->> 'trackId', '') <> p_track_id::text
     or coalesce(p_desired_document ->> 'rekordboxContentId', '') <> coalesce(p_rekordbox_content_id, '')
     or coalesce(p_desired_document ->> 'schemaVersion', '') <> p_schema_version::text
     or coalesce(p_rekordbox_content_id, '') = ''
     or coalesce(p_desired_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_imported_baseline_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or (
       p_imported_baseline_local_cue_fingerprint is not null
       and p_imported_baseline_local_cue_fingerprint !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'cue_draft_invalid_document' using errcode = '22023';
  end if;

  select t.master_db_id, t.master_content_id
    into v_master_db_id, v_master_content_id
    from public.rekordbox_tracks t
    join public.rekordbox_imports i on i.id = t.import_id
   where t.id = p_track_id
     and t.import_id = p_import_id
     and t.rekordbox_content_id = p_rekordbox_content_id
     and i.user_id = v_user_id;

  if not found then
    raise exception 'cue_draft_owner_mismatch' using errcode = '42501';
  end if;

  insert into public.cue_drafts (
    user_id,
    import_id,
    track_id,
    rekordbox_content_id,
    schema_version,
    desired_document,
    desired_fingerprint,
    imported_baseline_fingerprint,
    imported_baseline_local_cue_fingerprint,
    current_baseline_fingerprint,
    current_baseline_local_cue_fingerprint,
    master_db_id,
    master_content_id,
    revision,
    strategy_version,
    strategy_settings
  ) values (
    v_user_id,
    p_import_id,
    p_track_id,
    p_rekordbox_content_id,
    p_schema_version,
    p_desired_document,
    lower(p_desired_fingerprint),
    lower(p_imported_baseline_fingerprint),
    lower(p_imported_baseline_local_cue_fingerprint),
    lower(p_imported_baseline_fingerprint),
    lower(p_imported_baseline_local_cue_fingerprint),
    v_master_db_id,
    v_master_content_id,
    1,
    p_strategy_version,
    p_strategy_settings
  )
  on conflict (user_id, track_id) do update
    set import_id = excluded.import_id,
        rekordbox_content_id = excluded.rekordbox_content_id,
        schema_version = excluded.schema_version,
        desired_document = excluded.desired_document,
        desired_fingerprint = excluded.desired_fingerprint,
        -- Preserve the first proven import baseline. A legacy row that never
        -- had comparable local proof may be refreshed exactly once by re-save.
        imported_baseline_fingerprint = case
          when cue_drafts.imported_baseline_local_cue_fingerprint is null
            then excluded.imported_baseline_fingerprint
          else cue_drafts.imported_baseline_fingerprint
        end,
        imported_baseline_local_cue_fingerprint = coalesce(
          cue_drafts.imported_baseline_local_cue_fingerprint,
          excluded.imported_baseline_local_cue_fingerprint
        ),
        current_baseline_fingerprint = case
          when cue_drafts.current_baseline_local_cue_fingerprint is null
            then excluded.imported_baseline_fingerprint
          else coalesce(cue_drafts.current_baseline_fingerprint, cue_drafts.imported_baseline_fingerprint)
        end,
        current_baseline_local_cue_fingerprint = coalesce(
          cue_drafts.current_baseline_local_cue_fingerprint,
          excluded.imported_baseline_local_cue_fingerprint
        ),
        master_db_id = excluded.master_db_id,
        master_content_id = excluded.master_content_id,
        revision = cue_drafts.revision + 1,
        strategy_version = excluded.strategy_version,
        strategy_settings = excluded.strategy_settings,
        updated_at = now()
    where cue_drafts.revision = p_expected_revision
      and p_expected_revision > 0
  returning * into v_saved;

  if v_saved.id is null or (v_saved.revision = 1 and p_expected_revision <> 0) then
    raise exception 'cue_draft_revision_conflict' using errcode = '40001';
  end if;

  return next v_saved;
end;
$$;

revoke all on function public.save_cue_draft(uuid,uuid,text,integer,jsonb,text,text,bigint,text,jsonb,text) from public;
grant execute on function public.save_cue_draft(uuid,uuid,text,integer,jsonb,text,text,bigint,text,jsonb,text) to authenticated;

-- Keep the Stage 9 RPC safe for an older renderer: it now advances only the
-- current comparison baseline and leaves original import provenance untouched.
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
         current_baseline_fingerprint = lower(p_desired_fingerprint),
         current_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint),
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

-- Production Stage 10 uses the import-scoped v3 RPC. Exact duplicate completion
-- signals return the already-recorded row without changing timestamps or state.
create or replace function public.mark_cue_draft_applied_v3(
  p_import_id uuid,
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
  v_current public.cue_drafts%rowtype;
  v_saved public.cue_drafts%rowtype;
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

  select *
    into v_current
    from public.cue_drafts
   where user_id = v_user_id
     and import_id = p_import_id
     and track_id = p_track_id
   for update;

  if not found
     or v_current.revision <> p_revision
     or v_current.desired_fingerprint <> lower(p_desired_fingerprint) then
    raise exception 'cue_apply_revision_conflict' using errcode = '40001';
  end if;

  if v_current.last_apply_operation_id = p_operation_id then
    if v_current.applied_revision = p_revision
       and v_current.applied_fingerprint = lower(p_desired_fingerprint)
       and v_current.current_baseline_fingerprint = lower(p_desired_fingerprint)
       and v_current.current_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint) then
      return next v_current;
      return;
    end if;
    raise exception 'cue_apply_idempotency_conflict' using errcode = '40001';
  end if;

  update public.cue_drafts
     set applied_revision = p_revision,
         applied_fingerprint = lower(p_desired_fingerprint),
         applied_at = now(),
         current_baseline_fingerprint = lower(p_desired_fingerprint),
         current_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint),
         last_apply_operation_id = p_operation_id,
         last_apply_state = 'applied',
         last_apply_summary = p_result_summary
   where id = v_current.id
  returning * into v_saved;

  return next v_saved;
end;
$$;

revoke all on function public.mark_cue_draft_applied_v3(uuid, uuid, bigint, text, text, text, jsonb) from public, anon;
grant execute on function public.mark_cue_draft_applied_v3(uuid, uuid, bigint, text, text, text, jsonb) to authenticated;
