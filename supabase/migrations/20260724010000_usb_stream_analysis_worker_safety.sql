-- DropDex Patch 2: durable analysis worker acknowledgement and resumable pause states.
-- Destructive cleanup is intentionally impossible until the active worker has
-- published a stopped acknowledgement.

begin;

alter table public.rekordbox_imports
  add column if not exists analysis_worker_status text not null default 'idle',
  add column if not exists analysis_worker_stage text,
  add column if not exists analysis_worker_current_track_id uuid,
  add column if not exists analysis_worker_heartbeat_at timestamptz,
  add column if not exists analysis_worker_stop_requested_at timestamptz,
  add column if not exists analysis_worker_stopped_at timestamptz,
  add column if not exists analysis_worker_stopped_acknowledged boolean not null default true,
  add column if not exists analysis_worker_error text;

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_status_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_status_check check (
    status in (
      'created', 'uploading', 'queued', 'processing', 'running',
      'pause_requested', 'paused', 'cancel_requested', 'stopping',
      'deleting', 'cancelled', 'completed', 'failed', 'interrupted'
    )
  );

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_analysis_status_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_analysis_status_check check (
    analysis_status is null or analysis_status in (
      'not_requested', 'awaiting_upload', 'uploading', 'uploaded', 'parsing',
      'pause_requested', 'paused', 'stopping', 'cancelled', 'completed',
      'partial', 'failed', 'interrupted'
    )
  );

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_analysis_worker_status_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_analysis_worker_status_check check (
    analysis_worker_status in (
      'idle', 'queued', 'running', 'pause_requested', 'paused',
      'cancel_requested', 'stopping', 'deleting', 'stopped',
      'completed', 'failed', 'interrupted'
    )
  );

create index if not exists idx_rekordbox_imports_worker_activity
  on public.rekordbox_imports (analysis_worker_status, analysis_worker_heartbeat_at desc);

-- Replace the earlier partial index so every new live/stop state remains cheap
-- to discover for UI polling and restart recovery.
drop index if exists public.rekordbox_imports_user_inflight_idx;
create index rekordbox_imports_user_inflight_idx
  on public.rekordbox_imports (user_id, imported_at desc)
  where status in (
    'created', 'uploading', 'queued', 'processing', 'running',
    'pause_requested', 'cancel_requested', 'stopping', 'deleting'
  );

create or replace function public.enforce_rekordbox_import_state_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'cancelled' then
    raise exception 'terminal import state % cannot transition to %', old.status, new.status
      using errcode='23514';
  end if;

  if not (
    (old.status='created' and new.status in ('uploading','pause_requested','cancel_requested','cancelled','failed','interrupted')) or
    (old.status='uploading' and new.status in ('queued','pause_requested','cancel_requested','cancelled','failed','interrupted')) or
    (old.status='queued' and new.status in ('processing','running','pause_requested','cancel_requested','cancelled','failed','interrupted')) or
    (old.status='processing' and new.status in ('running','pause_requested','cancel_requested','stopping','completed','failed','interrupted')) or
    (old.status='running' and new.status in ('pause_requested','cancel_requested','stopping','completed','failed','interrupted')) or
    (old.status='pause_requested' and new.status in ('paused','stopping','cancel_requested','failed','interrupted')) or
    (old.status='paused' and new.status in ('queued','processing','running','cancel_requested','deleting','failed','interrupted')) or
    (old.status='cancel_requested' and new.status in ('stopping','deleting','cancelled','interrupted')) or
    (old.status='stopping' and new.status in ('paused','deleting','cancelled','interrupted')) or
    (old.status='deleting' and new.status in ('cancelled','interrupted')) or
    (old.status='completed' and new.status in ('pause_requested','paused','cancel_requested','deleting','interrupted')) or
    (old.status='failed' and new.status in ('cancel_requested','deleting')) or
    (old.status='interrupted' and new.status in ('queued','processing','running','paused','cancel_requested','deleting','failed'))
  ) then
    raise exception 'invalid import transition % -> %', old.status, new.status
      using errcode='23514';
  end if;

  new.updated_at := now();
  return new;
end $$;

-- A stop request is cooperative. Existing atomic writes may finish, but no new
-- stage begins after the next worker checkpoint. Only deletion/final terminal
-- states reject child writes at SQL, after the worker has acknowledged stop.
create or replace function public.reject_terminal_rekordbox_import_write()
returns trigger language plpgsql as $$
declare parent_status text;
begin
  select status into parent_status
  from public.rekordbox_imports
  where id = new.import_id;

  if parent_status in ('deleting','cancelled','failed') then
    raise exception 'import % is %', new.import_id, parent_status using errcode='23514';
  end if;
  return new;
end $$;

update public.rekordbox_imports
set analysis_worker_status = case
      when analysis_status = 'parsing' then 'interrupted'
      when analysis_status = 'paused' then 'paused'
      when analysis_status in ('completed','partial') then 'completed'
      when analysis_status = 'failed' then 'failed'
      else coalesce(analysis_worker_status, 'idle')
    end,
    analysis_worker_stage = case
      when analysis_status = 'parsing' then 'migration_recovery'
      else analysis_worker_stage
    end,
    analysis_worker_stopped_acknowledged = true,
    analysis_worker_stopped_at = case
      when analysis_status = 'parsing' then coalesce(analysis_worker_stopped_at, now())
      else analysis_worker_stopped_at
    end,
    analysis_status = case
      when analysis_status = 'parsing' then 'interrupted'
      else analysis_status
    end,
    retryable = case when analysis_status = 'parsing' then true else retryable end,
    error_code = case
      when analysis_status = 'parsing' then 'ANALYSIS_INTERRUPTED'
      else error_code
    end,
    error_message = case
      when analysis_status = 'parsing' then
        'Analysis was interrupted during the worker-safety migration. Resume analysis to continue.'
      else error_message
    end
where analysis_status = 'parsing'
   or analysis_worker_status is null;

comment on column public.rekordbox_imports.analysis_worker_stopped_acknowledged is
  'True only after the active analysis worker has stopped writing; destructive cleanup must require this acknowledgement.';
comment on column public.rekordbox_imports.analysis_worker_stage is
  'Last durable safe-checkpoint stage reported by the analysis worker.';

commit;
