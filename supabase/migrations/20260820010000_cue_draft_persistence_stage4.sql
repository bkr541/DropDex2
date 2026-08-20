-- ============================================================
-- DropDex Stage 4: durable Cue Points drafts
--
-- Imported Rekordbox cue rows stay immutable. This table owns the
-- authenticated user's complete desired cue document for one imported track.
-- Writes flow through save_cue_draft() for atomic revision protection.
-- ============================================================

create table if not exists public.cue_drafts (
  id                              uuid        primary key default gen_random_uuid(),
  user_id                         uuid        not null references auth.users(id) on delete cascade,
  import_id                       uuid        not null references public.rekordbox_imports(id) on delete cascade,
  track_id                        uuid        not null references public.rekordbox_tracks(id) on delete cascade,
  rekordbox_content_id            text        not null,
  schema_version                  integer     not null,
  desired_document                jsonb       not null,
  desired_fingerprint             text        not null,
  imported_baseline_fingerprint   text        not null,
  revision                        bigint      not null default 1,
  strategy_version                text,
  strategy_settings               jsonb,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint cue_drafts_owner_track_unique unique (user_id, track_id),
  constraint cue_drafts_revision_positive check (revision > 0),
  constraint cue_drafts_schema_version_positive check (schema_version > 0),
  constraint cue_drafts_desired_document_object check (jsonb_typeof(desired_document) = 'object')
);

create index if not exists cue_drafts_import_id_idx on public.cue_drafts (import_id);
create index if not exists cue_drafts_track_id_idx on public.cue_drafts (track_id);
create index if not exists cue_drafts_user_import_idx on public.cue_drafts (user_id, import_id);

alter table public.cue_drafts enable row level security;
revoke all on public.cue_drafts from anon, authenticated;
grant select on public.cue_drafts to authenticated;

-- Reads are direct and RLS-scoped. No direct INSERT/UPDATE/DELETE policy is
-- granted: writes are intentionally funneled through the revision-safe RPC.
drop policy if exists "Users can select their own cue drafts" on public.cue_drafts;
create policy "Users can select their own cue drafts"
  on public.cue_drafts for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
        from public.rekordbox_tracks
        join public.rekordbox_imports
          on rekordbox_imports.id = rekordbox_tracks.import_id
       where rekordbox_tracks.id = cue_drafts.track_id
         and rekordbox_tracks.import_id = cue_drafts.import_id
         and rekordbox_tracks.rekordbox_content_id = cue_drafts.rekordbox_content_id
         and rekordbox_imports.user_id = auth.uid()
    )
  );

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
  p_strategy_settings jsonb default null
)
returns setof public.cue_drafts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_saved public.cue_drafts%rowtype;
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
     or coalesce(p_imported_baseline_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'cue_draft_invalid_document' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.rekordbox_tracks t
      join public.rekordbox_imports i on i.id = t.import_id
     where t.id = p_track_id
       and t.import_id = p_import_id
       and t.rekordbox_content_id = p_rekordbox_content_id
       and i.user_id = v_user_id
  ) then
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
        revision = cue_drafts.revision + 1,
        strategy_version = excluded.strategy_version,
        strategy_settings = excluded.strategy_settings,
        updated_at = now()
    where cue_drafts.revision = p_expected_revision
      and p_expected_revision > 0
  returning * into v_saved;

  -- A new draft may only be created from expected revision 0. Existing drafts
  -- update only when their current revision exactly matches the caller.
  if v_saved.id is null or (v_saved.revision = 1 and p_expected_revision <> 0) then
    -- Raising rolls the statement back, including a create attempted with a
    -- non-zero expected revision. No partial row survives this exception.
    raise exception 'cue_draft_revision_conflict' using errcode = '40001';
  end if;

  return next v_saved;
end;
$$;

revoke all on function public.save_cue_draft(uuid,uuid,text,integer,jsonb,text,text,bigint,text,jsonb) from public;
grant execute on function public.save_cue_draft(uuid,uuid,text,integer,jsonb,text,text,bigint,text,jsonb) to authenticated;
