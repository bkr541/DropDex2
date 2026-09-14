-- Extend bulk_update_rekordbox_track_analysis to accept analysis_feature_statuses,
-- eliminating the N+1 per-row UPDATE fallback in the fast pipeline.
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
        analysis_completed_at timestamptz,
        analysis_feature_statuses jsonb
      )
  )
  update public.rekordbox_tracks t
     set analysis_parse_status          = coalesce(i.analysis_parse_status,          t.analysis_parse_status),
         analysis_parse_warnings        = coalesce(i.analysis_parse_warnings,        t.analysis_parse_warnings),
         analysis_failure_reason        = i.analysis_failure_reason,
         analysis_manifest_status       = coalesce(i.analysis_manifest_status,       t.analysis_manifest_status),
         analysis_reused_from_track_id  = coalesce(i.analysis_reused_from_track_id,  t.analysis_reused_from_track_id),
         analysis_source_fingerprint    = coalesce(i.analysis_source_fingerprint,    t.analysis_source_fingerprint),
         analysis_feature_schema_version = coalesce(i.analysis_feature_schema_version, t.analysis_feature_schema_version),
         analysis_queued_at             = coalesce(i.analysis_queued_at,             t.analysis_queued_at),
         analysis_started_at            = coalesce(i.analysis_started_at,            t.analysis_started_at),
         analysis_completed_at          = coalesce(i.analysis_completed_at,          t.analysis_completed_at),
         analysis_feature_statuses      = coalesce(i.analysis_feature_statuses,      t.analysis_feature_statuses)
    from incoming i
   where t.id = i.track_id
     and t.import_id = p_import_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

commit;
