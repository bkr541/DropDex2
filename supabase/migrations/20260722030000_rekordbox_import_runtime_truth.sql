-- ============================================================
-- DropDex: background import runtime truth and activation
--
-- Repairs contradictory historical terminal states, guarantees that a newly
-- completed snapshot becomes the active library at the database boundary, and
-- keeps progress fields coherent for the persistent frontend monitor.
-- ============================================================

begin;

-- Keep this migration independently safe after the schema-convergence repair.
alter table public.rekordbox_imports
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists upload_completed_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists error_code text,
  add column if not exists retryable boolean not null default false,
  add column if not exists analysis_status text,
  add column if not exists analysis_expected_track_count integer not null default 0,
  add column if not exists analysis_parsed_track_count integer not null default 0,
  add column if not exists analysis_failed_track_count integer not null default 0,
  add column if not exists analysis_completed_at timestamptz,
  add column if not exists analysis_progress_processed_track_count integer not null default 0,
  add column if not exists analysis_progress_total_track_count integer not null default 0,
  add column if not exists analysis_current_track_id uuid,
  add column if not exists analysis_current_track_title text,
  add column if not exists analysis_current_track_artist text,
  add column if not exists analysis_current_track_label text,
  add column if not exists analysis_progress_updated_at timestamptz;

-- Historical versions could finish the durable job while leaving a subordinate
-- analysis state at uploading/parsing. Only stale completed rows are repaired:
-- completed snapshots are allowed to re-enter a live analysis state when a user
-- deliberately resumes/reprocesses them.
with repair_targets as (
  select id
  from public.rekordbox_imports
  where
    (
      status = 'completed'
      and (
        analysis_status is null
        or (
          analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing')
          and coalesce(analysis_progress_updated_at, updated_at, imported_at, now())
              < now() - interval '15 minutes'
        )
        or (
          analysis_status not in ('awaiting_upload', 'uploading', 'uploaded', 'parsing')
          and (
            analysis_current_track_id is not null
            or analysis_current_track_title is not null
            or analysis_current_track_artist is not null
            or analysis_current_track_label is not null
            or error_code is not null
            or error_message is not null
            or retryable
            or completed_at is null
          )
        )
      )
    )
    or (
      status in ('failed', 'cancelled')
      and (
        analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing')
        or analysis_current_track_id is not null
        or analysis_current_track_title is not null
        or analysis_current_track_artist is not null
        or analysis_current_track_label is not null
        or (status = 'cancelled' and cancelled_at is null)
      )
    )
)
update public.rekordbox_imports as imports
set analysis_status = case
      when imports.status = 'completed'
           and (imports.analysis_status is null
                or imports.analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing')) then
        case
          when coalesce(imports.analysis_expected_track_count, 0) = 0 then 'not_requested'
          when coalesce(imports.analysis_parsed_track_count, 0) >= coalesce(imports.analysis_expected_track_count, 0)
               and coalesce(imports.analysis_failed_track_count, 0) = 0 then 'completed'
          when coalesce(imports.analysis_parsed_track_count, 0) > 0 then 'partial'
          else 'failed'
        end
      when imports.status in ('failed', 'cancelled')
           and imports.analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing') then 'failed'
      else imports.analysis_status
    end,
    completed_at = case
      when imports.status = 'completed' then coalesce(imports.completed_at, imports.updated_at, imports.imported_at, now())
      else imports.completed_at
    end,
    cancelled_at = case
      when imports.status = 'cancelled' then coalesce(imports.cancelled_at, imports.updated_at, now())
      else imports.cancelled_at
    end,
    analysis_completed_at = case
      when imports.status = 'completed' and coalesce(imports.analysis_expected_track_count, 0) > 0
        then coalesce(imports.analysis_completed_at, imports.completed_at, imports.updated_at, now())
      when imports.status in ('failed', 'cancelled')
           and imports.analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing')
        then coalesce(imports.analysis_completed_at, imports.updated_at, now())
      else imports.analysis_completed_at
    end,
    analysis_progress_total_track_count = case
      when imports.status = 'completed' then greatest(
        coalesce(imports.analysis_progress_total_track_count, 0),
        coalesce(imports.analysis_expected_track_count, 0)
      )
      else imports.analysis_progress_total_track_count
    end,
    analysis_progress_processed_track_count = case
      when imports.status = 'completed' then greatest(
        coalesce(imports.analysis_progress_total_track_count, 0),
        coalesce(imports.analysis_expected_track_count, 0)
      )
      else imports.analysis_progress_processed_track_count
    end,
    analysis_current_track_id = null,
    analysis_current_track_title = null,
    analysis_current_track_artist = null,
    analysis_current_track_label = null,
    analysis_progress_updated_at = coalesce(imports.analysis_progress_updated_at, imports.updated_at, now()),
    error_code = case when imports.status = 'completed' then null else imports.error_code end,
    error_message = case when imports.status = 'completed' then null else imports.error_message end,
    retryable = case when imports.status = 'completed' then false else imports.retryable end,
    updated_at = coalesce(imports.updated_at, now())
from repair_targets
where imports.id = repair_targets.id;

-- Repair a missed activation for an import that completed before this migration
-- was installed. Respect any explicit library selection made after completion by
-- comparing the settings timestamp with the candidate's completion time.
with latest_completed as (
  select distinct on (user_id)
    user_id,
    id as import_id,
    coalesce(completed_at, updated_at, imported_at) as finished_at
  from public.rekordbox_imports
  where status = 'completed'
  order by user_id, coalesce(completed_at, updated_at, imported_at) desc, id desc
)
update public.rekordbox_user_settings as settings
set active_import_id = latest.import_id,
    updated_at = now()
from latest_completed as latest
where settings.user_id = latest.user_id
  and settings.active_import_id is distinct from latest.import_id
  and coalesce(settings.updated_at, '-infinity'::timestamptz) <= latest.finished_at;

with latest_completed as (
  select distinct on (user_id)
    user_id,
    id as import_id
  from public.rekordbox_imports
  where status = 'completed'
  order by user_id, coalesce(completed_at, updated_at, imported_at) desc, id desc
)
insert into public.rekordbox_user_settings (user_id, active_import_id, updated_at)
select latest.user_id, latest.import_id, now()
from latest_completed as latest
where not exists (
  select 1
  from public.rekordbox_user_settings as settings
  where settings.user_id = latest.user_id
);

-- Keep duration mirrors useful for old snapshots when either side was stored.
-- Rows where both values are zero cannot be reconstructed without re-importing.
update public.rekordbox_tracks
set duration_ms = duration_seconds::bigint * 1000
where coalesce(duration_ms, 0) = 0
  and coalesce(duration_seconds, 0) > 0;

update public.rekordbox_tracks
set duration_seconds = round(duration_ms::numeric / 1000.0)::integer
where coalesce(duration_seconds, 0) = 0
  and coalesce(duration_ms, 0) > 0;

create or replace function public.normalize_rekordbox_import_terminal_truth()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_count integer;
  parsed_count integer;
  failed_count integer;
begin
  if new.status not in ('completed', 'failed', 'cancelled') then
    return new;
  end if;

  new.analysis_current_track_id := null;
  new.analysis_current_track_title := null;
  new.analysis_current_track_artist := null;
  new.analysis_current_track_label := null;
  new.analysis_progress_updated_at := coalesce(new.analysis_progress_updated_at, now());

  expected_count := greatest(coalesce(new.analysis_expected_track_count, 0), 0);
  parsed_count := greatest(coalesce(new.analysis_parsed_track_count, 0), 0);
  failed_count := greatest(coalesce(new.analysis_failed_track_count, 0), 0);

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    new.error_code := null;
    new.error_message := null;
    new.retryable := false;

    if new.analysis_status is null
       or new.analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing') then
      if expected_count = 0 then
        new.analysis_status := 'not_requested';
      elsif parsed_count >= expected_count and failed_count = 0 then
        new.analysis_status := 'completed';
      elsif parsed_count > 0 then
        new.analysis_status := 'partial';
      else
        new.analysis_status := 'failed';
      end if;
    end if;

    if expected_count > 0 then
      new.analysis_completed_at := coalesce(new.analysis_completed_at, now());
      new.analysis_progress_total_track_count := greatest(
        coalesce(new.analysis_progress_total_track_count, 0), expected_count
      );
      new.analysis_progress_processed_track_count := new.analysis_progress_total_track_count;
    end if;
  elsif new.analysis_status in ('awaiting_upload', 'uploading', 'uploaded', 'parsing') then
    new.analysis_status := 'failed';
    new.analysis_completed_at := coalesce(new.analysis_completed_at, now());
  end if;

  if new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  return new;
end;
$$;

-- Normalize only inserts that are already terminal and updates that transition
-- the durable status. Later analysis-only updates on a completed snapshot must
-- remain free to enter parsing during a deliberate resume operation.
drop trigger if exists zz_normalize_rekordbox_import_terminal_insert on public.rekordbox_imports;
create trigger zz_normalize_rekordbox_import_terminal_insert
before insert on public.rekordbox_imports
for each row execute function public.normalize_rekordbox_import_terminal_truth();

drop trigger if exists zz_normalize_rekordbox_import_terminal_transition on public.rekordbox_imports;
create trigger zz_normalize_rekordbox_import_terminal_transition
before update of status on public.rekordbox_imports
for each row
when (old.status is distinct from new.status)
execute function public.normalize_rekordbox_import_terminal_truth();

-- Make successful imports active in the same database transaction that marks
-- them complete. Backend and frontend retries remain harmless fallbacks.
create or replace function public.activate_completed_rekordbox_import()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rekordbox_user_settings (user_id, active_import_id, updated_at)
  values (new.user_id, new.id, now())
  on conflict (user_id) do update
    set active_import_id = excluded.active_import_id,
        updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists activate_completed_rekordbox_import on public.rekordbox_imports;
create trigger activate_completed_rekordbox_import
after update of status on public.rekordbox_imports
for each row
when (new.status = 'completed' and old.status is distinct from 'completed')
execute function public.activate_completed_rekordbox_import();

create index if not exists rekordbox_imports_user_inflight_idx
  on public.rekordbox_imports (user_id, imported_at desc)
  where status in ('created', 'uploading', 'queued', 'processing', 'cancel_requested');

notify pgrst, 'reload schema';

commit;
