-- Rekordbox imports are durable jobs with explicit terminal states.
alter table public.rekordbox_imports drop constraint if exists rekordbox_imports_status_check;
alter table public.rekordbox_imports alter column status set default 'created';
alter table public.rekordbox_imports add constraint rekordbox_imports_status_check
  check (status in ('created','uploading','queued','processing','cancel_requested','cancelled','completed','failed'));

alter table public.rekordbox_imports add column if not exists updated_at timestamptz not null default now();
alter table public.rekordbox_imports add column if not exists upload_completed_at timestamptz;
alter table public.rekordbox_imports add column if not exists processing_started_at timestamptz;
alter table public.rekordbox_imports add column if not exists completed_at timestamptz;
alter table public.rekordbox_imports add column if not exists cancelled_at timestamptz;
alter table public.rekordbox_imports add column if not exists error_code text;
alter table public.rekordbox_imports add column if not exists retryable boolean not null default false;

create or replace function public.enforce_rekordbox_import_state_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    new.updated_at := now();
    return new;
  end if;
  if old.status in ('cancelled','completed','failed') then
    raise exception 'terminal import state % cannot transition to %', old.status, new.status using errcode='23514';
  end if;
  if not (
    (old.status='created' and new.status in ('uploading','cancel_requested','cancelled','failed')) or
    (old.status='uploading' and new.status in ('queued','cancel_requested','cancelled','failed')) or
    (old.status='queued' and new.status in ('processing','cancel_requested','cancelled','failed')) or
    (old.status='processing' and new.status in ('cancel_requested','cancelled','completed','failed')) or
    (old.status='cancel_requested' and new.status='cancelled')
  ) then
    raise exception 'invalid import transition % -> %', old.status, new.status using errcode='23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists enforce_rekordbox_import_state_transition on public.rekordbox_imports;
create trigger enforce_rekordbox_import_state_transition
before update of status on public.rekordbox_imports
for each row execute function public.enforce_rekordbox_import_state_transition();

-- A cancellation race may reach SQL after the worker's last application-level check.
-- Reject those late child writes at the database boundary.
create or replace function public.reject_terminal_rekordbox_import_write()
returns trigger language plpgsql as $$
declare parent_status text;
begin
  select status into parent_status from public.rekordbox_imports where id = new.import_id;
  if parent_status in ('cancel_requested','cancelled','failed') then
    raise exception 'import % is %', new.import_id, parent_status using errcode='23514';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'rekordbox_tracks','rekordbox_playlists','rekordbox_analysis_assets',
    'rekordbox_track_beat_grids','rekordbox_track_waveforms','rekordbox_track_phrases',
    'rekordbox_cues','rekordbox_recommendation_edges','rekordbox_related_track_lists',
    'rekordbox_analysis_asset_references'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists reject_terminal_import_write on public.%I', t);
      execute format('create trigger reject_terminal_import_write before insert or update on public.%I for each row execute function public.reject_terminal_rekordbox_import_write()', t);
    end if;
  end loop;
end $$;
