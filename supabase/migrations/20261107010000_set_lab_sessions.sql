create table public.set_lab_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Keep the import snapshot ID when the original library is deleted.
  source_import_id uuid not null,
  is_draft boolean not null,
  name text,
  schema_version integer not null check (schema_version > 0),
  document jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint set_lab_session_name check (
    (is_draft and name is null)
    or (not is_draft and name is not null and btrim(name) <> '')
  ),
  constraint set_lab_session_document check (
    (jsonb_typeof(document) = 'object'
      and document -> 'schemaVersion' = to_jsonb(schema_version)
      and document ->> 'userId' = user_id::text
      and document ->> 'sourceImportId' = source_import_id::text
      and document ->> 'status' = case when is_draft then 'draft' else 'saved' end
      and document ->> 'name' is not distinct from name) is true
  )
);

create unique index set_lab_one_draft_per_import
  on public.set_lab_sessions (user_id, source_import_id) where is_draft;
create index set_lab_saved_by_user
  on public.set_lab_sessions (user_id, updated_at desc) where not is_draft;

alter table public.set_lab_sessions enable row level security;
revoke all on public.set_lab_sessions from public, anon, authenticated;
grant select on public.set_lab_sessions to authenticated;

create policy "Users can read their own Set Lab sessions"
  on public.set_lab_sessions for select to authenticated
  using (user_id = (select auth.uid()));

-- All writes go through this RPC so clients cannot bypass the revision check.
create function public.write_set_lab_session_v1(
  p_user_id uuid,
  p_source_import_id uuid,
  p_document jsonb,
  p_expected_revision integer,
  p_saved_set_id uuid default null
)
returns setof public.set_lab_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_draft boolean := p_saved_set_id is null;
  v_slots jsonb := p_document -> 'slots';
  v_slot_count integer;
  v_row public.set_lab_sessions%rowtype;
begin
  if v_user_id is null or v_user_id is distinct from p_user_id then
    raise exception 'set_lab_account_mismatch' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.rekordbox_imports
    where id = p_source_import_id and user_id = v_user_id
  ) then
    raise exception 'set_lab_library_unavailable' using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 0
    or (not v_is_draft and p_expected_revision <> 0)
    or jsonb_typeof(v_slots) is distinct from 'array' then
    raise exception 'set_lab_invalid_document' using errcode = '22023';
  end if;
  v_slot_count := jsonb_array_length(v_slots);
  if (v_slot_count <> 5 and not (v_is_draft and v_slot_count = 0))
    or exists (
      select 1 from jsonb_array_elements(v_slots) with ordinality as slots(slot, position)
      where slot -> 'position' is distinct from to_jsonb(position)
        or coalesce(btrim(slot ->> 'trackId'), '') = ''
        or coalesce(btrim(slot ->> 'trackIdentityKey'), '') = ''
    )
    or (select count(distinct slot ->> 'trackId') from jsonb_array_elements(v_slots) as slots(slot)) <> v_slot_count
    or (select count(distinct slot ->> 'trackIdentityKey') from jsonb_array_elements(v_slots) as slots(slot)) <> v_slot_count then
    raise exception 'set_lab_invalid_slots' using errcode = '22023';
  end if;

  if not v_is_draft then
    insert into public.set_lab_sessions (id, user_id, source_import_id, is_draft, name, schema_version, document)
    values (p_saved_set_id, v_user_id, p_source_import_id, false, p_document ->> 'name', 1, p_document)
    on conflict (id) do nothing
    returning * into v_row;

    if not found then
      select * into v_row from public.set_lab_sessions
      where id = p_saved_set_id and user_id = v_user_id and not is_draft and document = p_document;
    end if;
  elsif p_expected_revision = 0 then
    insert into public.set_lab_sessions (user_id, source_import_id, is_draft, schema_version, document)
    values (v_user_id, p_source_import_id, true, 1, p_document)
    on conflict (user_id, source_import_id) where is_draft do nothing
    returning * into v_row;
  else
    update public.set_lab_sessions
    set document = p_document, schema_version = 1, revision = revision + 1, updated_at = now()
    where user_id = v_user_id and source_import_id = p_source_import_id
      and is_draft and revision = p_expected_revision
    returning * into v_row;
  end if;

  -- A retry after a lost response can acknowledge an already-stored document.
  if v_row.id is null and v_is_draft then
    select * into v_row from public.set_lab_sessions
    where user_id = v_user_id and source_import_id = p_source_import_id
      and is_draft and document = p_document;
  end if;
  if v_row.id is null then
    raise exception 'set_lab_revision_conflict' using errcode = 'P0001';
  end if;
  return next v_row;
end;
$$;

revoke all on function public.write_set_lab_session_v1(uuid, uuid, jsonb, integer, uuid) from public, anon, authenticated;
grant execute on function public.write_set_lab_session_v1(uuid, uuid, jsonb, integer, uuid) to authenticated;
