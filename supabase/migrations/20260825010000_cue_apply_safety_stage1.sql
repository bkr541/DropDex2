-- ============================================================
-- DropDex cue apply safety Stage 1
--
-- Persist the imported local-DjmdCue baseline separately from the Stage 4
-- desired-document fingerprint, and bind saved drafts to the strongest track
-- identity already owned by rekordbox_tracks. Existing rows are deliberately
-- not backfilled: legacy drafts remain readable but must be rebased by a fresh
-- save before destructive local Rekordbox apply is eligible.
-- ============================================================

alter table public.cue_drafts
  add column if not exists imported_baseline_local_cue_fingerprint text,
  add column if not exists master_db_id text,
  add column if not exists master_content_id text;

alter table public.cue_drafts
  drop constraint if exists cue_drafts_imported_local_fingerprint_sha256,
  add constraint cue_drafts_imported_local_fingerprint_sha256
    check (
      imported_baseline_local_cue_fingerprint is null
      or imported_baseline_local_cue_fingerprint ~ '^[0-9a-f]{64}$'
    );

-- Replace the Stage 4 function with a backward-compatible signature. The new
-- parameter is appended and nullable so older clients can still save drafts,
-- but those legacy saves remain apply-ineligible until they provide a real
-- imported-local baseline. Track identity is copied from the authenticated
-- rekordbox_tracks row instead of trusting renderer-supplied identity fields.
drop function if exists public.save_cue_draft(uuid,uuid,text,integer,jsonb,text,text,bigint,text,jsonb);

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
    p_desired_fingerprint,
    p_imported_baseline_fingerprint,
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
        imported_baseline_fingerprint = excluded.imported_baseline_fingerprint,
        imported_baseline_local_cue_fingerprint = excluded.imported_baseline_local_cue_fingerprint,
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
