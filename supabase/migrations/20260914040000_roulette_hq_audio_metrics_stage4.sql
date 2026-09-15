-- Roulette Stage 4: persist lightweight stem/audio intelligence with canonical
-- installation-scoped HQ assets. Metrics are supplemental scoring evidence and
-- are intentionally not part of the ready-state constraint.

alter table public.roulette_stem_assets
  add column if not exists analysis_metrics jsonb;

alter table public.roulette_stem_assets
  drop constraint if exists roulette_stem_assets_analysis_metrics_object_check;
alter table public.roulette_stem_assets
  add constraint roulette_stem_assets_analysis_metrics_object_check
  check (analysis_metrics is null or jsonb_typeof(analysis_metrics) = 'object');

-- Replace the Stage 1 RPC with a metrics-aware overload so file identity,
-- separation version, and the measurements derived from those exact files are
-- published in the same per-track transaction.
drop function if exists public.commit_roulette_stem_pair(
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  integer,
  bigint,
  double precision,
  text,
  bigint,
  integer,
  integer,
  bigint,
  double precision
);

create or replace function public.commit_roulette_stem_pair(
  p_track_id uuid,
  p_installation_id text,
  p_source_fingerprint text,
  p_separator_version text,
  p_vocals_locator text,
  p_vocals_duration_ms bigint,
  p_vocals_sample_rate_hz integer,
  p_vocals_channel_count integer,
  p_vocals_file_size_bytes bigint,
  p_vocals_file_mtime_ms double precision,
  p_vocals_analysis_metrics jsonb,
  p_instrumental_locator text,
  p_instrumental_duration_ms bigint,
  p_instrumental_sample_rate_hz integer,
  p_instrumental_channel_count integer,
  p_instrumental_file_size_bytes bigint,
  p_instrumental_file_mtime_ms double precision,
  p_instrumental_analysis_metrics jsonb
)
returns setof public.roulette_stem_assets
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_installation_id is null or length(btrim(p_installation_id)) = 0 then
    raise exception 'installation id is required';
  end if;
  if p_source_fingerprint is null or length(btrim(p_source_fingerprint)) = 0 then
    raise exception 'source fingerprint is required';
  end if;
  if p_separator_version is null or length(btrim(p_separator_version)) = 0 then
    raise exception 'separator version is required';
  end if;
  if p_vocals_locator is null or length(btrim(p_vocals_locator)) = 0
     or p_instrumental_locator is null or length(btrim(p_instrumental_locator)) = 0 then
    raise exception 'both stem locators are required';
  end if;

  insert into public.roulette_stem_assets (
    track_id,
    stem_type,
    installation_id,
    status,
    storage_locator,
    source_fingerprint,
    separator_version,
    contract_version,
    duration_ms,
    sample_rate_hz,
    channel_count,
    file_size_bytes,
    file_mtime_ms,
    analysis_metrics,
    failure_code,
    failure_message
  )
  values
    (
      p_track_id,
      'vocals',
      p_installation_id,
      'ready',
      p_vocals_locator,
      p_source_fingerprint,
      p_separator_version,
      1,
      p_vocals_duration_ms,
      p_vocals_sample_rate_hz,
      p_vocals_channel_count,
      p_vocals_file_size_bytes,
      p_vocals_file_mtime_ms,
      p_vocals_analysis_metrics,
      null,
      null
    ),
    (
      p_track_id,
      'instrumental',
      p_installation_id,
      'ready',
      p_instrumental_locator,
      p_source_fingerprint,
      p_separator_version,
      1,
      p_instrumental_duration_ms,
      p_instrumental_sample_rate_hz,
      p_instrumental_channel_count,
      p_instrumental_file_size_bytes,
      p_instrumental_file_mtime_ms,
      p_instrumental_analysis_metrics,
      null,
      null
    )
  on conflict (track_id, stem_type, installation_id) do update set
    status = excluded.status,
    storage_locator = excluded.storage_locator,
    source_fingerprint = excluded.source_fingerprint,
    separator_version = excluded.separator_version,
    contract_version = excluded.contract_version,
    duration_ms = excluded.duration_ms,
    sample_rate_hz = excluded.sample_rate_hz,
    channel_count = excluded.channel_count,
    file_size_bytes = excluded.file_size_bytes,
    file_mtime_ms = excluded.file_mtime_ms,
    analysis_metrics = excluded.analysis_metrics,
    failure_code = null,
    failure_message = null;

  return query
  select asset.*
    from public.roulette_stem_assets asset
   where asset.track_id = p_track_id
     and asset.installation_id = p_installation_id
     and asset.stem_type in ('vocals', 'instrumental')
   order by asset.stem_type;
end;
$$;

grant execute on function public.commit_roulette_stem_pair(
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  integer,
  bigint,
  double precision,
  jsonb,
  text,
  bigint,
  integer,
  integer,
  bigint,
  double precision,
  jsonb
) to authenticated;
