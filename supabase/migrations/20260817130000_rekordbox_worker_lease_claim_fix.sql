-- DropDex Rekordbox worker-lease claim repair.
--
-- The original claim RPC used a column-list ON CONFLICT target while
-- returning TABLE columns with the same names. In PL/pgSQL those output-column
-- names are variables, so PostgreSQL can reject the conflict target as
-- ambiguous (42702). Target the table's primary-key constraint instead while
-- preserving the existing RPC signature and response contract.

begin;

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
  on conflict on constraint rekordbox_import_worker_leases_pkey do update
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

revoke all on function public.claim_rekordbox_import_worker_lease(uuid, uuid, text, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_rekordbox_import_worker_lease(uuid, uuid, text, text, uuid, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;
