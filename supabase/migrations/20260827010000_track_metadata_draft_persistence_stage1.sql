-- ============================================================
-- DropDex Genre Editing Stage 1: metadata draft persistence
--
-- Generic persisted metadata intent, initially restricted to Genre. Canonical
-- rekordbox_tracks metadata remains separate and read-only to the renderer;
-- authenticated mutations are owned by narrow SECURITY DEFINER RPCs.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.track_metadata_drafts (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references auth.users(id) on delete cascade,
  import_id                uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id                 uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  field                    text        not null,
  schema_version           integer     not null,
  pending_value            text,
  imported_baseline_value  text,
  current_baseline_value   text,
  master_db_id             text        not null,
  master_content_id        text        not null,
  revision                 bigint      not null default 1,
  draft_fingerprint        text        not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  applied_revision         bigint,
  applied_value            text,
  applied_at               timestamptz,
  last_apply_operation_id  text,
  last_apply_state         text,
  last_apply_summary       jsonb,
  constraint track_metadata_drafts_owner_track_field_unique unique (user_id, track_id, field),
  constraint track_metadata_drafts_field_supported check (field in ('genre')),
  constraint track_metadata_drafts_schema_version_supported check (schema_version = 1),
  constraint track_metadata_drafts_pending_genre_normalized
    check (pending_value is null or (pending_value = btrim(pending_value) and pending_value <> '' and char_length(pending_value) <= 255)),
  constraint track_metadata_drafts_revision_positive check (revision > 0),
  constraint track_metadata_drafts_applied_revision_positive
    check (applied_revision is null or applied_revision > 0),
  constraint track_metadata_drafts_fingerprint_sha256
    check (draft_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint track_metadata_drafts_master_db_id_present
    check (btrim(master_db_id) <> ''),
  constraint track_metadata_drafts_master_content_id_present
    check (btrim(master_content_id) <> '')
);

create index if not exists track_metadata_drafts_user_import_idx
  on public.track_metadata_drafts (user_id, import_id);
create index if not exists track_metadata_drafts_user_import_pending_idx
  on public.track_metadata_drafts (user_id, import_id, field, track_id);
create index if not exists track_metadata_drafts_track_idx
  on public.track_metadata_drafts (track_id, field);

alter table public.track_metadata_drafts enable row level security;
revoke all on public.track_metadata_drafts from public, anon, authenticated;
grant select on public.track_metadata_drafts to authenticated;

drop policy if exists "Users can select their own track metadata drafts" on public.track_metadata_drafts;
create policy "Users can select their own track metadata drafts"
  on public.track_metadata_drafts for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
        from public.rekordbox_tracks t
        join public.rekordbox_imports i on i.id = t.import_id
       where t.id = track_metadata_drafts.track_id
         and t.import_id = track_metadata_drafts.import_id
         and i.user_id = auth.uid()
    )
  );

-- Rekordbox's pinned pyrekordbox model declares DjmdGenre.Name VARCHAR(255).
-- This helper is the server-authoritative normalization boundary for metadata
-- draft values. Future fields must add an explicit typed branch here.
create or replace function public.normalize_track_metadata_value_v1(
  p_field text,
  p_value text
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_value text;
begin
  if p_field is distinct from 'genre' then
    raise exception 'metadata_draft_unsupported_field' using errcode = '22023';
  end if;

  v_value := btrim(p_value);
  if v_value = '' then
    v_value := null;
  end if;

  if v_value is not null and char_length(v_value) > 255 then
    raise exception 'metadata_draft_genre_too_long' using errcode = '22001';
  end if;

  return v_value;
end;
$$;

revoke all on function public.normalize_track_metadata_value_v1(text, text) from public, anon, authenticated;

create or replace function public.track_metadata_draft_fingerprint_v1(
  p_track_id uuid,
  p_field text,
  p_schema_version integer,
  p_pending_value text,
  p_current_baseline_value text
)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select encode(
    digest(
      convert_to(
        jsonb_build_object(
          'trackId', p_track_id,
          'field', p_field,
          'schemaVersion', p_schema_version,
          'pendingValue', p_pending_value,
          'currentBaselineValue', p_current_baseline_value
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function public.track_metadata_draft_fingerprint_v1(uuid, text, integer, text, text) from public, anon, authenticated;

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

  if p_schema_version is distinct from 1
     or p_expected_revision is null
     or p_expected_revision < 0 then
    raise exception 'metadata_draft_invalid_request' using errcode = '22023';
  end if;

  -- The field validator and normalization live server-side so renderer input
  -- cannot expand the supported mutation surface or change normalization rules.
  v_pending_value := public.normalize_track_metadata_value_v1(p_field, p_pending_value);

  select t.genre, t.master_db_id, t.master_content_id
    into v_canonical_value, v_master_db_id, v_master_content_id
    from public.rekordbox_tracks t
    join public.rekordbox_imports i on i.id = t.import_id
   where t.id = p_track_id
     and t.import_id = p_import_id
     and i.user_id = v_user_id
   for share of t;

  if not found then
    raise exception 'metadata_draft_owner_mismatch' using errcode = '42501';
  end if;

  if coalesce(btrim(v_master_db_id), '') = ''
     or coalesce(btrim(v_master_content_id), '') = '' then
    raise exception 'metadata_draft_missing_master_identity' using errcode = '22023';
  end if;

  select *
    into v_current
    from public.track_metadata_drafts d
   where d.user_id = v_user_id
     and d.track_id = p_track_id
     and d.field = p_field
   for update;

  if found then
    if v_current.import_id <> p_import_id then
      raise exception 'metadata_draft_owner_mismatch' using errcode = '42501';
    end if;

    if p_expected_revision <> v_current.revision then
      raise exception 'metadata_draft_revision_conflict' using errcode = '40001';
    end if;

    -- Returning to the moving baseline removes only pending metadata intent.
    -- Canonical rekordbox_tracks.genre is never changed by this Stage 1 RPC.
    if v_pending_value is not distinct from v_current.current_baseline_value then
      delete from public.track_metadata_drafts
       where id = v_current.id;
      return;
    end if;

    update public.track_metadata_drafts
       set schema_version = p_schema_version,
           pending_value = v_pending_value,
           master_db_id = v_master_db_id,
           master_content_id = v_master_content_id,
           revision = revision + 1,
           draft_fingerprint = public.track_metadata_draft_fingerprint_v1(
             p_track_id,
             p_field,
             p_schema_version,
             v_pending_value,
             current_baseline_value
           ),
           updated_at = now()
     where id = v_current.id
    returning * into v_saved;

    return next v_saved;
    return;
  end if;

  if p_expected_revision <> 0 then
    raise exception 'metadata_draft_revision_conflict' using errcode = '40001';
  end if;

  -- A new desired value already equal to canonical state is a deterministic
  -- no-op. There is no false pending row to display or Apply later.
  if v_pending_value is not distinct from v_canonical_value then
    return;
  end if;

  begin
    insert into public.track_metadata_drafts (
      user_id,
      import_id,
      track_id,
      field,
      schema_version,
      pending_value,
      imported_baseline_value,
      current_baseline_value,
      master_db_id,
      master_content_id,
      revision,
      draft_fingerprint
    ) values (
      v_user_id,
      p_import_id,
      p_track_id,
      p_field,
      p_schema_version,
      v_pending_value,
      v_canonical_value,
      v_canonical_value,
      v_master_db_id,
      v_master_content_id,
      1,
      public.track_metadata_draft_fingerprint_v1(
        p_track_id,
        p_field,
        p_schema_version,
        v_pending_value,
        v_canonical_value
      )
    )
    returning * into v_saved;
  exception when unique_violation then
    -- A concurrent first-save won the logical-key race.
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
  if v_user_id is null then
    raise exception 'metadata_draft_auth_required' using errcode = '42501';
  end if;

  if p_field is distinct from 'genre'
     or p_expected_revision is null
     or p_expected_revision <= 0 then
    raise exception 'metadata_draft_invalid_request' using errcode = '22023';
  end if;

  -- Authorize against the canonical import/track relationship even when no
  -- draft exists, preventing draft existence from becoming an ownership oracle.
  perform 1
    from public.rekordbox_tracks t
    join public.rekordbox_imports i on i.id = t.import_id
   where t.id = p_track_id
     and t.import_id = p_import_id
     and i.user_id = v_user_id;

  if not found then
    raise exception 'metadata_draft_owner_mismatch' using errcode = '42501';
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
    return;
  end if;

  if v_current.revision <> p_expected_revision then
    raise exception 'metadata_draft_revision_conflict' using errcode = '40001';
  end if;

  delete from public.track_metadata_drafts
   where id = v_current.id
  returning * into v_deleted;

  return next v_deleted;
end;
$$;

revoke all on function public.discard_track_metadata_draft_v1(uuid, uuid, text, bigint) from public, anon;
grant execute on function public.discard_track_metadata_draft_v1(uuid, uuid, text, bigint) to authenticated;
