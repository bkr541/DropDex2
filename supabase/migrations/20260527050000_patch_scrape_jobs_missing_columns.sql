-- ============================================================================
-- DropDex Migration: Patch scrape_jobs missing columns
--
-- ROOT CAUSE
-- ──────────
-- Migration 030000 defined public.scrape_jobs with CREATE TABLE IF NOT EXISTS.
-- The table was already provisioned in the live Supabase project (without
-- artist_id and other columns), so CREATE TABLE IF NOT EXISTS was a no-op
-- and the new columns were never added.
--
-- This migration adds every column defined in 030000 using
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS, making it safe to re-apply.
--
-- Also creates public.artist_search_pages if it did not get created (the FK
-- from artist_search_pages → artist_search_runs may have silently failed if
-- artist_search_runs did not exist when 030000 ran).
--
-- IDEMPOTENCY
-- ───────────
-- All statements use IF NOT EXISTS or ADD COLUMN IF NOT EXISTS.
-- ============================================================================

begin;

-- ── Patch public.scrape_jobs ─────────────────────────────────────────────────

alter table public.scrape_jobs
  add column if not exists requested_by_user_id   uuid        references auth.users(id) on delete set null;

alter table public.scrape_jobs
  add column if not exists job_type               text        not null default 'artist_setlist_discovery';

alter table public.scrape_jobs
  add column if not exists source                 text        not null default '1001tracklists';

alter table public.scrape_jobs
  add column if not exists artist_id              uuid        references public.artists(id) on delete cascade;

alter table public.scrape_jobs
  add column if not exists status                 text        not null default 'queued';

alter table public.scrape_jobs
  add column if not exists pages_scraped          integer     not null default 0;

alter table public.scrape_jobs
  add column if not exists results_found          integer     not null default 0;

alter table public.scrape_jobs
  add column if not exists total_results_reported integer;

alter table public.scrape_jobs
  add column if not exists error_message          text;

alter table public.scrape_jobs
  add column if not exists started_at             timestamptz;

alter table public.scrape_jobs
  add column if not exists completed_at           timestamptz;

alter table public.scrape_jobs
  add column if not exists created_at             timestamptz not null default now();

-- Add status check constraint if not already present
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public'
       and table_name   = 'scrape_jobs'
       and constraint_name = 'scrape_jobs_status_check'
  ) then
    alter table public.scrape_jobs
      add constraint scrape_jobs_status_check
      check (status in ('queued', 'running', 'completed', 'failed'));
  end if;
end $$;

-- Indexes (guarded)
create index if not exists scrape_jobs_artist_id_idx
  on public.scrape_jobs (artist_id);

create index if not exists scrape_jobs_requested_by_user_id_idx
  on public.scrape_jobs (requested_by_user_id);

create index if not exists scrape_jobs_status_idx
  on public.scrape_jobs (status);


-- ── Ensure public.artist_search_pages exists ─────────────────────────────────
--
-- artist_search_pages was created in 030000 with a FK to artist_search_runs.
-- If artist_search_runs did not exist at that point the FK would have failed.
-- Creating the table here (with IF NOT EXISTS) is safe for both cases.

create table if not exists public.artist_search_pages (
  id                uuid        primary key default gen_random_uuid(),
  search_run_id     uuid        not null references public.artist_search_runs(id) on delete cascade,
  page_number       integer     not null,
  result_count      integer     not null default 0,
  source_url        text,
  scraped_at        timestamptz not null default now(),
  raw_metadata_json jsonb,
  constraint artist_search_pages_run_page_uidx
    unique (search_run_id, page_number)
);

create index if not exists artist_search_pages_search_run_id_idx
  on public.artist_search_pages (search_run_id);


-- ── FK: artist_search_runs.scrape_job_id → scrape_jobs(id) ──────────────────

do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints   tc
      join information_schema.key_column_usage    kcu
        on  tc.constraint_name = kcu.constraint_name
        and tc.table_schema    = kcu.table_schema
     where tc.table_schema    = 'public'
       and tc.table_name      = 'artist_search_runs'
       and tc.constraint_type = 'FOREIGN KEY'
       and kcu.column_name    = 'scrape_job_id'
  ) then
    alter table public.artist_search_runs
      add constraint artist_search_runs_scrape_job_id_fkey
      foreign key (scrape_job_id) references public.scrape_jobs(id)
      on delete set null
      not valid;
  end if;
end $$;

commit;
