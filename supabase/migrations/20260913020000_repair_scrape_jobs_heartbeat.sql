-- Repair: migration 20260721020000 was recorded as applied but the heartbeat_at
-- and updated_at columns on scrape_jobs did not land on the remote schema.
-- Safe to re-apply with IF NOT EXISTS guards.
alter table public.scrape_jobs
  add column if not exists heartbeat_at timestamptz,
  add column if not exists updated_at   timestamptz not null default now();

create index if not exists scrape_jobs_active_heartbeat_idx
  on public.scrape_jobs (heartbeat_at)
  where status in ('queued', 'running');

commit;
