-- DropDex Rekordbox import remaining worker safety.
-- Adds cross-process ownership leases and independent trailing raw archival.

begin;

alter table public.rekordbox_imports
  add column if not exists raw_archival_status text not null default 'skipped';

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_raw_archival_status_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_raw_archival_status_check check (
    raw_archival_status in ('skipped', 'queued', 'running', 'completed', 'paused', 'failed')
  );

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_readiness_stage_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_readiness_stage_check check (
    readiness_stage in (
      'metadata_pending', 'library_metadata_ready', 'analysis_processing',
      'cues_and_beat_grids_processing', 'preview_waveforms_processing',
      'detailed_waveforms_processing', 'optional_archival_processing',
      'analysis_paused', 'analysis_complete', 'analysis_partial'
    )
  );

create table if not exists public.rekordbox_import_worker_leases (
  import_id uuid not null
    references public.rekordbox_imports(id) on delete cascade,
  worker_kind text not null,
  user_id uuid not null,
  owner_id text not null,
  owner_token uuid not null,
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  stage text,
  current_track_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (import_id, worker_kind),
  constraint rekordbox_import_worker_leases_kind_check
    check (worker_kind in ('analysis', 'raw_archival'))
);

create index if not exists rekordbox_import_worker_leases_expiry_idx
  on public.rekordbox_import_worker_leases (lease_expires_at);

alter table public.rekordbox_import_worker_leases enable row level security;

-- The backend uses the service-role key and bypasses RLS. Browser clients must
-- never be able to claim, refresh, release, or inspect worker ownership.
revoke all on table public.rekordbox_import_worker_leases from anon, authenticated;

create or replace function public.claim_rekordbox_import_worker_lease(
  p_import_id uuid,
  p_user_id uuid,
  p_worker_kind text,
  p_owner_id text,
  p_owner_token uuid,
  p_lease_seconds integer
)
returns table (
  acquired boolean,
  import_id uuid,
  worker_kind text,
  owner_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.rekordbox_import_worker_leases%rowtype;
  v_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 45), 300));
begin
  if p_worker_kind not in ('analysis', 'raw_archival') then
    raise exception 'invalid worker kind' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.rekordbox_imports i
     where i.id = p_import_id
       and i.user_id = p_user_id
  ) then
    return query select false, p_import_id, p_worker_kind, p_owner_token, null::timestamptz;
    return;
  end if;

  insert into public.rekordbox_import_worker_leases as lease (
    import_id,
    worker_kind,
    user_id,
    owner_id,
    owner_token,
    lease_expires_at,
    heartbeat_at,
    stage,
    current_track_id,
    updated_at
  ) values (
    p_import_id,
    p_worker_kind,
    p_user_id,
    left(p_owner_id, 500),
    p_owner_token,
    now() + make_interval(secs => v_seconds),
    now(),
    'claimed',
    null,
    now()
  )
  on conflict (import_id, worker_kind) do update
     set user_id = excluded.user_id,
         owner_id = excluded.owner_id,
         owner_token = excluded.owner_token,
         lease_expires_at = excluded.lease_expires_at,
         heartbeat_at = excluded.heartbeat_at,
         stage = excluded.stage,
         current_track_id = null,
         updated_at = now()
   where lease.lease_expires_at <= now()
      or lease.owner_token = excluded.owner_token
  returning * into v_row;

  if not found then
    return query select false, p_import_id, p_worker_kind, p_owner_token, null::timestamptz;
  else
    return query
      select true, v_row.import_id, v_row.worker_kind, v_row.owner_token, v_row.lease_expires_at;
  end if;
end;
$$;

create or replace function public.renew_rekordbox_import_worker_lease(
  p_import_id uuid,
  p_worker_kind text,
  p_owner_token uuid,
  p_lease_seconds integer,
  p_stage text default null,
  p_current_track_id uuid default null
)
returns table (
  renewed boolean,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expiry timestamptz;
  v_renewed boolean := false;
  v_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 45), 300));
begin
  update public.rekordbox_import_worker_leases as lease
     set lease_expires_at = now() + make_interval(secs => v_seconds),
         heartbeat_at = now(),
         stage = left(p_stage, 500),
         current_track_id = p_current_track_id,
         updated_at = now()
   where lease.import_id = p_import_id
     and lease.worker_kind = p_worker_kind
     and lease.owner_token = p_owner_token
     and lease.lease_expires_at > now()
  returning lease.lease_expires_at into v_expiry;
  v_renewed := found;

  return query select v_renewed, v_expiry;
end;
$$;

create or replace function public.release_rekordbox_import_worker_lease(
  p_import_id uuid,
  p_worker_kind text,
  p_owner_token uuid
)
returns table (released boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released boolean := false;
begin
  delete from public.rekordbox_import_worker_leases
   where import_id = p_import_id
     and worker_kind = p_worker_kind
     and owner_token = p_owner_token;
  v_released := found;
  return query select v_released;
end;
$$;

revoke all on function public.claim_rekordbox_import_worker_lease(uuid, uuid, text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.renew_rekordbox_import_worker_lease(uuid, text, uuid, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.release_rekordbox_import_worker_lease(uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_rekordbox_import_worker_lease(uuid, uuid, text, text, uuid, integer)
  to service_role;
grant execute on function public.renew_rekordbox_import_worker_lease(uuid, text, uuid, integer, text, uuid)
  to service_role;
grant execute on function public.release_rekordbox_import_worker_lease(uuid, text, uuid)
  to service_role;

update public.rekordbox_imports
   set raw_archival_status = case
         when analysis_status in ('completed', 'partial') then 'queued'
         else 'skipped'
       end
 where raw_archival_status = 'skipped'
   and exists (
     select 1
       from public.rekordbox_analysis_assets a
      where a.import_id = rekordbox_imports.id
        and a.asset_type in ('DAT', 'EXT')
        and a.staging_key is not null
        and a.archive_storage_path is null
   );

comment on table public.rekordbox_import_worker_leases is
  'Exclusive, expiring ownership for analysis and raw archival workers; browser clients have no access.';
comment on column public.rekordbox_imports.raw_archival_status is
  'Trailing grouped DAT/EXT archival state. It never gates library readiness.';

notify pgrst, 'reload schema';

commit;
