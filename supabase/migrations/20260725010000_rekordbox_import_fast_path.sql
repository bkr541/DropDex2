-- DropDex Rekordbox import fast path and progressive-readiness state.
-- Existing DAT/EXT/2EX imports remain readable. No raw objects are deleted.

alter table public.rekordbox_imports
  add column if not exists library_ready_at timestamptz,
  add column if not exists readiness_stage text not null default 'metadata_pending',
  add column if not exists required_analysis_file_count integer not null default 0,
  add column if not exists optional_archival_file_count integer not null default 0,
  add column if not exists optional_archival_status text not null default 'skipped',
  add column if not exists performance_metrics jsonb not null default '{}'::jsonb,
  add column if not exists analysis_queue_track_count integer not null default 0,
  add column if not exists analysis_running_track_count integer not null default 0,
  add column if not exists analysis_throughput_tracks_per_second numeric,
  add column if not exists analysis_estimated_seconds_remaining integer;

alter table public.rekordbox_tracks
  add column if not exists analysis_manifest_status text not null default 'needs_analysis',
  add column if not exists analysis_source_fingerprint text,
  add column if not exists analysis_feature_schema_version text,
  add column if not exists analysis_failure_reason text,
  add column if not exists analysis_queued_at timestamptz,
  add column if not exists analysis_started_at timestamptz,
  add column if not exists analysis_completed_at timestamptz;

alter table public.rekordbox_analysis_assets
  alter column storage_path drop not null,
  add column if not exists staging_key text,
  add column if not exists source_mtime_ms bigint,
  add column if not exists source_fingerprint text,
  add column if not exists feature_schema_version text,
  add column if not exists archive_storage_bucket text,
  add column if not exists archive_storage_path text,
  add column if not exists archive_member_path text,
  add column if not exists retained_from_asset_id uuid
    references public.rekordbox_analysis_assets(id) on delete set null,
  add column if not exists archival_status text not null default 'not_requested';

alter table public.rekordbox_analysis_assets
  drop constraint if exists rekordbox_analysis_assets_upload_status_check;
alter table public.rekordbox_analysis_assets
  add constraint rekordbox_analysis_assets_upload_status_check check (
    upload_status in ('pending', 'uploading', 'staged', 'uploaded', 'archived', 'failed')
  );

alter table public.rekordbox_analysis_assets
  drop constraint if exists rekordbox_analysis_assets_archival_status_check;
alter table public.rekordbox_analysis_assets
  add constraint rekordbox_analysis_assets_archival_status_check check (
    archival_status in ('not_requested', 'queued', 'archiving', 'archived', 'skipped', 'failed')
  );

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_readiness_stage_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_readiness_stage_check check (
    readiness_stage in (
      'metadata_pending', 'library_metadata_ready', 'cues_and_beat_grids_processing',
      'preview_waveforms_processing', 'detailed_waveforms_processing',
      'optional_archival_processing', 'analysis_paused', 'analysis_complete', 'analysis_partial'
    )
  );

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_optional_archival_status_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_optional_archival_status_check check (
    optional_archival_status in ('skipped', 'queued', 'running', 'completed', 'paused', 'failed')
  );

alter table public.rekordbox_tracks
  drop constraint if exists rekordbox_tracks_analysis_manifest_status_check;
alter table public.rekordbox_tracks
  add constraint rekordbox_tracks_analysis_manifest_status_check check (
    analysis_manifest_status in (
      'reused', 'metadata_only', 'needs_dat', 'needs_ext', 'needs_analysis',
      'reparse_from_retained', 'unavailable'
    )
  );

-- Backfill legacy imports without inventing missing fingerprints. Completed or
-- intentionally skipped legacy tracks remain reusable; metadata-only rows do
-- not become falsely incomplete merely because they never had an ANLZ path.
update public.rekordbox_tracks
   set analysis_manifest_status = case
         when analysis_data_file_path is null or btrim(analysis_data_file_path) = ''
           then 'metadata_only'
         when analysis_parse_status in ('completed', 'partial', 'reused', 'skipped')
           then 'reused'
         else 'needs_analysis'
       end
 where analysis_manifest_status = 'needs_analysis';

-- Existing completed imports are immediately browseable after deployment.
update public.rekordbox_imports
   set library_ready_at = coalesce(library_ready_at, completed_at, updated_at),
       readiness_stage = 'analysis_complete',
       optional_archival_status = case
         when optional_archival_status = 'skipped' then 'skipped'
         else optional_archival_status
       end
 where status = 'completed';

create unique index if not exists rekordbox_analysis_assets_import_relative_path_unique
  on public.rekordbox_analysis_assets(import_id, relative_path);

create index if not exists rekordbox_tracks_import_manifest_status_idx
  on public.rekordbox_tracks(import_id, analysis_manifest_status);
create index if not exists rekordbox_assets_import_track_status_idx
  on public.rekordbox_analysis_assets(import_id, track_id, upload_status);
create index if not exists rekordbox_assets_source_fingerprint_idx
  on public.rekordbox_analysis_assets(import_id, source_fingerprint);

create or replace function public.merge_rekordbox_import_performance_metrics(
  p_import_id uuid,
  p_metrics jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.rekordbox_imports
     set performance_metrics =
           (coalesce(performance_metrics, '{}'::jsonb) - 'timings_ms' - 'counts' - 'bytes')
           || (coalesce(p_metrics, '{}'::jsonb) - 'timings_ms' - 'counts' - 'bytes')
           || jsonb_build_object(
                'timings_ms', (
                  select coalesce(jsonb_object_agg(metric_key, metric_total), '{}'::jsonb)
                    from (
                      select metric_key, to_jsonb(sum(metric_value::numeric)) as metric_total
                        from (
                          select key as metric_key, value as metric_value
                            from jsonb_each_text(coalesce(performance_metrics -> 'timings_ms', '{}'::jsonb))
                          union all
                          select key, value
                            from jsonb_each_text(coalesce(p_metrics -> 'timings_ms', '{}'::jsonb))
                        ) timing_values
                       group by metric_key
                    ) timing_totals
                ),
                'counts', (
                  select coalesce(jsonb_object_agg(metric_key, metric_total), '{}'::jsonb)
                    from (
                      select metric_key, to_jsonb(sum(metric_value::numeric)) as metric_total
                        from (
                          select key as metric_key, value as metric_value
                            from jsonb_each_text(coalesce(performance_metrics -> 'counts', '{}'::jsonb))
                          union all
                          select key, value
                            from jsonb_each_text(coalesce(p_metrics -> 'counts', '{}'::jsonb))
                        ) count_values
                       group by metric_key
                    ) count_totals
                ),
                'bytes', (
                  select coalesce(jsonb_object_agg(metric_key, metric_total), '{}'::jsonb)
                    from (
                      select metric_key, to_jsonb(sum(metric_value::numeric)) as metric_total
                        from (
                          select key as metric_key, value as metric_value
                            from jsonb_each_text(coalesce(performance_metrics -> 'bytes', '{}'::jsonb))
                          union all
                          select key, value
                            from jsonb_each_text(coalesce(p_metrics -> 'bytes', '{}'::jsonb))
                        ) byte_values
                       group by metric_key
                    ) byte_totals
                )
              ),
         updated_at = now()
   where id = p_import_id;
$$;

create or replace function public.bulk_update_rekordbox_track_analysis(
  p_import_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  with incoming as (
    select *
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
        track_id uuid,
        analysis_parse_status text,
        analysis_parse_warnings jsonb,
        analysis_failure_reason text,
        analysis_manifest_status text,
        analysis_reused_from_track_id uuid,
        analysis_source_fingerprint text,
        analysis_feature_schema_version text,
        analysis_queued_at timestamptz,
        analysis_started_at timestamptz,
        analysis_completed_at timestamptz
      )
  )
  update public.rekordbox_tracks t
     set analysis_parse_status = coalesce(i.analysis_parse_status, t.analysis_parse_status),
         analysis_parse_warnings = coalesce(i.analysis_parse_warnings, t.analysis_parse_warnings),
         analysis_failure_reason = i.analysis_failure_reason,
         analysis_manifest_status = coalesce(i.analysis_manifest_status, t.analysis_manifest_status),
         analysis_reused_from_track_id = coalesce(i.analysis_reused_from_track_id, t.analysis_reused_from_track_id),
         analysis_source_fingerprint = coalesce(i.analysis_source_fingerprint, t.analysis_source_fingerprint),
         analysis_feature_schema_version = coalesce(i.analysis_feature_schema_version, t.analysis_feature_schema_version),
         analysis_queued_at = coalesce(i.analysis_queued_at, t.analysis_queued_at),
         analysis_started_at = coalesce(i.analysis_started_at, t.analysis_started_at),
         analysis_completed_at = coalesce(i.analysis_completed_at, t.analysis_completed_at)
    from incoming i
   where t.id = i.track_id
     and t.import_id = p_import_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.rekordbox_tracks
  drop constraint if exists rekordbox_tracks_analysis_parse_status_check;
alter table public.rekordbox_tracks
  add constraint rekordbox_tracks_analysis_parse_status_check check (
    analysis_parse_status in (
      'not_requested', 'queued', 'parsing', 'completed', 'partial',
      'failed', 'missing_required', 'skipped', 'reused'
    )
  );

alter table public.rekordbox_imports
  drop constraint if exists rekordbox_imports_analysis_status_check;
alter table public.rekordbox_imports
  add constraint rekordbox_imports_analysis_status_check check (
    analysis_status is null or analysis_status in (
      'not_requested', 'awaiting_upload', 'uploading', 'uploaded', 'queued',
      'parsing', 'pause_requested', 'paused', 'stopping', 'cancelled',
      'completed', 'partial', 'failed', 'interrupted'
    )
  );
