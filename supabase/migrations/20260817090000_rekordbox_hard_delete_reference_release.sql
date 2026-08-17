-- Allow PostgreSQL FK cleanup to release soft cross-import Rekordbox references
-- while preserving the terminal-import write barrier for real application writes.
--
-- Hard deletion removes analysis assets/tracks that can still be referenced by
-- newer failed/cancelled snapshots through ON DELETE SET NULL foreign keys.
-- The worker-safety trigger previously rejected those FK-generated UPDATEs
-- because the dependent snapshot was terminal, which made Delete Library retry
-- forever with DELETE_CLEANUP_FAILED. Only pure reference-to-NULL releases are
-- exempted here; every other INSERT/UPDATE remains blocked.

begin;

create or replace function public.reject_terminal_rekordbox_import_write()
returns trigger
language plpgsql
as $$
declare
  parent_status text;
  old_row jsonb;
  new_row jsonb;
  reference_release boolean := false;
begin
  select status into parent_status
  from public.rekordbox_imports
  where id = new.import_id;

  if parent_status is null
     or parent_status not in ('deleting', 'cancelled', 'failed') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);

    if tg_table_name = 'rekordbox_tracks' then
      reference_release :=
        old_row ->> 'analysis_reused_from_track_id' is not null
        and new_row ->> 'analysis_reused_from_track_id' is null
        and (old_row - 'analysis_reused_from_track_id')
            = (new_row - 'analysis_reused_from_track_id');

    elsif tg_table_name = 'rekordbox_analysis_assets' then
      reference_release :=
        old_row ->> 'retained_from_asset_id' is not null
        and new_row ->> 'retained_from_asset_id' is null
        and (old_row - 'retained_from_asset_id')
            = (new_row - 'retained_from_asset_id');

    elsif tg_table_name = 'rekordbox_track_beat_grids' then
      reference_release :=
        old_row ->> 'source_asset_id' is not null
        and new_row ->> 'source_asset_id' is null
        and (old_row - 'source_asset_id') = (new_row - 'source_asset_id');

    elsif tg_table_name = 'rekordbox_track_waveforms' then
      reference_release :=
        (old_row - array['source_dat_asset_id', 'source_ext_asset_id', 'source_2ex_asset_id'])
          = (new_row - array['source_dat_asset_id', 'source_ext_asset_id', 'source_2ex_asset_id'])
        and (
          (old_row ->> 'source_dat_asset_id' is not null and new_row ->> 'source_dat_asset_id' is null)
          or (old_row ->> 'source_ext_asset_id' is not null and new_row ->> 'source_ext_asset_id' is null)
          or (old_row ->> 'source_2ex_asset_id' is not null and new_row ->> 'source_2ex_asset_id' is null)
        )
        and (
          new_row ->> 'source_dat_asset_id' is null
          or new_row ->> 'source_dat_asset_id' is not distinct from old_row ->> 'source_dat_asset_id'
        )
        and (
          new_row ->> 'source_ext_asset_id' is null
          or new_row ->> 'source_ext_asset_id' is not distinct from old_row ->> 'source_ext_asset_id'
        )
        and (
          new_row ->> 'source_2ex_asset_id' is null
          or new_row ->> 'source_2ex_asset_id' is not distinct from old_row ->> 'source_2ex_asset_id'
        );
    end if;

    if reference_release then
      return new;
    end if;
  end if;

  raise exception 'import % is %', new.import_id, parent_status using errcode='23514';
end
$$;

commit;
