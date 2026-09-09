-- Roulette Stage 6: publish both generated stem records in one database transaction.
-- The desktop worker publishes the validated pair directory atomically first; this
-- RPC then makes both canonical rows ready together under the caller's existing RLS.

create or replace function public.commit_roulette_stem_pair(
  p_track_id uuid,
  p_source_fingerprint text,
  p_separator_version text,
  p_vocals_locator text,
  p_vocals_duration_ms bigint,
  p_vocals_sample_rate_hz integer,
  p_vocals_channel_count integer,
  p_vocals_file_size_bytes bigint,
  p_vocals_file_mtime_ms double precision,
  p_instrumental_locator text,
  p_instrumental_duration_ms bigint,
  p_instrumental_sample_rate_hz integer,
  p_instrumental_channel_count integer,
  p_instrumental_file_size_bytes bigint,
  p_instrumental_file_mtime_ms double precision
)
returns setof public.roulette_stem_assets
language plpgsql
security invoker
set search_path = public
as $$
begin
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
    failure_code,
    failure_message
  )
  values
    (
      p_track_id,
      'vocals',
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
      null,
      null
    ),
    (
      p_track_id,
      'instrumental',
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
      null,
      null
    )
  on conflict (track_id, stem_type) do update set
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
    failure_code = null,
    failure_message = null;

  return query
  select asset.*
    from public.roulette_stem_assets asset
   where asset.track_id = p_track_id
     and asset.stem_type in ('vocals', 'instrumental')
   order by asset.stem_type;
end;
$$;

grant execute on function public.commit_roulette_stem_pair(
  uuid,
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
) to authenticated;
